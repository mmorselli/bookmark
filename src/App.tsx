import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, AppState, BackHandler, FlatList, Platform, Pressable, ScrollView,
  StatusBar, StyleSheet, Text as NativeText, View, useWindowDimensions,
} from 'react-native';
import type { TextProps } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFonts } from 'expo-font';
import { defaultPreferences, selectBookmarks } from './core/bookmarks';
import type { Bookmark, Preferences, SeenFilter, Sort } from './core/bookmarks';
import type { Repository } from './core/repository';
import { openRepository } from './platform/storage';
import { consumeImportInterruption, listBrowsers, openUrl, pickHtml, subscribeRemote } from './platform/device';
import type { Browser, RemoteKey } from './platform/device';
import { colors as c } from './ui/theme';
import { appInfo, diagnostic } from './platform/diagnostics';
import { LogViewer } from './ui/LogViewer';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type Focus = { area: 'toolbar' | 'list'; index: number };
type Panel = 'sort' | 'filter' | 'browser' | 'bookmark' | null;
const sorts: { id: Sort; label: string; icon: IconName; description: string }[] = [
  { id: 'imported', label: 'Più recenti', icon: 'time-outline', description: 'Data della prima importazione, dalla più recente' },
  { id: 'alphabetical', label: 'Titolo A–Z', icon: 'text-outline', description: 'Ordine alfabetico crescente' },
  { id: 'rating', label: 'Valutazione', icon: 'star-outline', description: 'Prima i segnalibri con più stelle' },
];
const filters: { id: SeenFilter; label: string; description: string }[] = [
  { id: 'all', label: 'Tutti', description: 'Visti e da vedere' },
  { id: 'unseen', label: 'Da vedere', description: 'Solo i segnalibri che non hai ancora aperto' },
  { id: 'seen', label: 'Già visti', description: 'Solo i segnalibri segnati come visti' },
];
const date = (timestamp: number) => new Date(timestamp).toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: 'numeric' });
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Operazione non riuscita. Riprova.';
function Text(props: TextProps) {
  return <NativeText {...props} style={[{ fontFamily: Platform.OS === 'web' ? 'Arial, sans-serif' : 'sans-serif' }, props.style]} />;
}
function Icon({ name, size = 21, color = c.muted }: { name: IconName; size?: number; color?: string }) {
  return <Ionicons name={name} size={size} color={color} />;
}
function Stars({ rating, size = 20 }: { rating: number | null; size?: number }) {
  return <View style={s.stars} accessibilityLabel={rating ? `${rating} stelle su 5` : 'Non valutato'}>
    {[1, 2, 3, 4, 5].map(value => <Icon key={value} name={value <= (rating ?? 0) ? 'star' : 'star-outline'} size={size} color={rating && value <= rating ? c.yellow : c.dim} />)}
  </View>;
}

export default function App() {
  const [fontsLoaded, fontError] = useFonts(Ionicons.font);
  const { width, height } = useWindowDimensions();
  const compact = width < 1000;
  const compactToolbar = width < 1200;
  const iconToolbar = width < 800;
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [prefs, setPrefs] = useState<Preferences>(defaultPreferences);
  const [ready, setReady] = useState(false);
  const [startupError, setStartupError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>({ area: 'toolbar', index: 0 });
  const [panel, setPanel] = useState<Panel>(null);
  const [panelIndex, setPanelIndex] = useState(0);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [browsers, setBrowsers] = useState<Browser[]>([]);
  const [notice, setNotice] = useState<{ text: string; error: boolean } | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const [logsOpen, setLogsOpen] = useState(false);
  const logsRemote = useRef<((key: RemoteKey) => void) | null>(null);
  const repository = useRef<Repository | null>(null);
  const locked = useRef(false);
  const preferencesQueue = useRef<Promise<unknown>>(Promise.resolve());
  const list = useRef<FlatList<Bookmark>>(null);
  const listViewport = useRef<View>(null);
  const itemViews = useRef(new Map<string, View>());
  const listOffset = useRef(0);
  const panelScroll = useRef<ScrollView>(null);
  const panelPositions = useRef<Record<number, number>>({});
  const scrollRetry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedIndex = useRef(-1);
  const scrollWithFocus = useRef(true);
  const pointerFocus = (next: Focus) => { scrollWithFocus.current = false; setFocus(next); };
  const visible = useMemo(() => selectBookmarks(bookmarks, prefs), [bookmarks, prefs]);
  const active = bookmarks.find(b => b.id === activeId);

  const initialize = useCallback(async () => {
    diagnostic('app.initialize.begin');
    setStartupError(null);
    try {
      const db = await openRepository();
      repository.current = db;
      const [rows, settings] = await Promise.all([db.list(), db.getPreferences()]);
      diagnostic('app.initialize.loaded', { rows: rows.length, settings });
      setBookmarks(rows); setPrefs(settings); setReady(true);
      if (consumeImportInterruption()) setNotice({ error: true, text: 'Bookmark è stato riavviato durante la selezione del file. Importazione interrotta: riprova. (IMPORT_INTERRUPTED)' });
      if (selectBookmarks(rows, settings).length) setFocus({ area: 'list', index: 0 });
    } catch (e) { diagnostic('app.initialize.failed', e); setStartupError(errorText(e)); }
  }, []);
  useEffect(() => { void initialize(); }, [initialize]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', state => {
      setAppState(state);
      diagnostic('app.state', { state, locked: locked.current });
    });
    return () => sub.remove();
  }, []);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    diagnostic('operation.stage', busy);
    const timer = setInterval(() => diagnostic('operation.pending', { stage: busy, elapsedMs: Date.now() - started }), 10000);
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => { if (notice) diagnostic('ui.notice', notice); }, [notice]);
  useEffect(() => {
    if (!notice || notice.error || appState !== 'active') return;
    const timer = setTimeout(() => setNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [notice, appState]);
  useEffect(() => {
    if (focus.area === 'list' && focus.index >= visible.length) {
      setFocus(visible.length ? { area: 'list', index: visible.length - 1 } : { area: 'toolbar', index: 0 });
    }
  }, [visible.length, focus]);
  useEffect(() => {
    selectedIndex.current = focus.area === 'list' && visible.length ? Math.min(focus.index, visible.length - 1) : -1;
    if (scrollWithFocus.current && selectedIndex.current >= 0) list.current?.scrollToIndex({ index: selectedIndex.current, animated: false, viewPosition: 0 });
  }, [focus, visible, prefs.fontSize]);
  useEffect(() => () => { if (scrollRetry.current) clearTimeout(scrollRetry.current); }, []);
  useEffect(() => {
    panelScroll.current?.scrollTo({ y: Math.max(0, (panelPositions.current[panelIndex] ?? 0) - 8), animated: true });
  }, [panelIndex]);

  const announceError = (e: unknown) => { diagnostic('operation.failed', e); setNotice({ text: errorText(e), error: true }); };
  const changePrefs = (patch: Partial<Preferences>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    preferencesQueue.current = preferencesQueue.current.then(() => repository.current!.savePreferences(next)).catch(announceError);
  };
  const perform = async (label: string, task: () => Promise<void>) => {
    if (locked.current || !repository.current) { diagnostic('operation.skipped', { label, locked: locked.current, repository: !!repository.current }); return; }
    diagnostic('operation.begin', label);
    locked.current = true; setBusy(label);
    try { await task(); } catch (e) { announceError(e); }
    finally { diagnostic('operation.end', label); locked.current = false; setBusy(null); }
  };
  const importFile = () => {
    const attempt = Date.now().toString(36);
    diagnostic('import.press', { attempt, locked: locked.current });
    return perform('Selezione del file…', async () => {
      diagnostic('import.picker.call', { attempt });
      const file = await pickHtml(attempt);
      diagnostic('import.picker.return', { attempt, file: !!file, chars: file?.html.length });
      if (!file) {
        setNotice({ error: false, text: 'Importazione annullata dal gestore file: nessun file ricevuto. Se avevi selezionato un file, prova un altro gestore.' });
        return;
      }
      setBusy('Importazione in corso…');
      // Let React paint the progress indicator before parsing a large export.
      await new Promise(resolve => setTimeout(resolve, 30));
      const result = await repository.current!.importHtml(file.html);
      diagnostic('import.database.complete', { attempt, ...result });
      const rows = await repository.current!.list();
      diagnostic('import.list.loaded', { attempt, rows: rows.length, visible: selectBookmarks(rows, prefs).length });
      setBookmarks(rows);
      setNotice({ error: false, text: `${result.inserted} nuovi · ${result.duplicates} già presenti · ${result.skipped} ignorati` });
      setFocus({ area: 'list', index: 0 });
    });
  };
  const updateBookmark = (bookmark: Bookmark, patch: Partial<Pick<Bookmark, 'seen' | 'hidden' | 'rating'>>) =>
    perform('Salvataggio…', async () => {
      await repository.current!.update(bookmark.id, patch);
      setBookmarks(rows => rows.map(row => row.id === bookmark.id ? { ...row, ...patch } : row));
    });
  const visit = (bookmark: Bookmark) => perform('Apertura del browser…', async () => {
    await openUrl(bookmark.url, prefs.browser);
    await repository.current!.update(bookmark.id, { seen: 1 });
    setBookmarks(rows => rows.map(row => row.id === bookmark.id ? { ...row, seen: 1 } : row));
    setPanel(null);
  });
  const openBookmarkMenu = (bookmark: Bookmark) => {
    setActiveId(bookmark.id); setPanelIndex(0); panelPositions.current = {}; setPanel('bookmark');
  };
  const showPanel = (next: Panel) => {
    panelPositions.current = {}; setPanelIndex(0); setPanel(next);
    if (next === 'browser') void listBrowsers().then(setBrowsers).catch(announceError);
  };
  const toolbar = [
    { label: 'Importa HTML', icon: 'add-outline' as IconName, action: importFile },
    { label: sorts.find(sort => sort.id === prefs.sort)!.label, icon: 'swap-vertical-outline' as IconName, action: () => showPanel('sort') },
    { label: filters.find(filter => filter.id === prefs.seenFilter)!.label, icon: 'filter-outline' as IconName, action: () => showPanel('filter') },
    { label: 'Riduci testo', icon: 'remove-outline' as IconName, action: () => changePrefs({ fontSize: Math.max(20, prefs.fontSize - 2) }) },
    { label: 'Ingrandisci testo', icon: 'add-outline' as IconName, action: () => changePrefs({ fontSize: Math.min(38, prefs.fontSize + 2) }) },
    { label: prefs.showHidden ? 'Nascondi nascosti' : 'Mostra nascosti', icon: (prefs.showHidden ? 'eye-outline' : 'eye-off-outline') as IconName, action: () => changePrefs({ showHidden: !prefs.showHidden }) },
    { label: 'Browser', icon: 'globe-outline' as IconName, action: () => showPanel('browser') },
    { label: 'Log', icon: 'document-text-outline' as IconName, action: () => setLogsOpen(true) },
  ];
  const panelItems = panel === 'sort' ? sorts.map(sort => ({ label: sort.label, description: sort.description, icon: sort.icon, checked: prefs.sort === sort.id, action: () => { changePrefs({ sort: sort.id }); setPanel(null); } }))
    : panel === 'filter' ? filters.map(filter => ({ label: filter.label, description: filter.description, icon: 'checkmark-circle-outline' as IconName, checked: prefs.seenFilter === filter.id, action: () => { changePrefs({ seenFilter: filter.id }); setPanel(null); } }))
    : panel === 'browser' ? [{ id: null, name: 'Predefinito di sistema' }, ...browsers].map(browser => ({ label: browser.name, description: browser.id === null ? 'Usa il browser predefinito del dispositivo' : 'Usa questo browser per tutti i segnalibri', icon: 'globe-outline' as IconName, checked: prefs.browser === browser.id, action: () => { changePrefs({ browser: browser.id }); setPanel(null); } }))
    : [];
  const menuAction = (index: number) => {
    if (panel !== 'bookmark') { panelItems[index]?.action(); return; }
    if (!active) { setPanel(null); return; }
    if (index === 0) void updateBookmark(active, { seen: active.seen ? 0 : 1 });
    if (index === 1) void updateBookmark(active, { rating: (active.rating ?? 0) % 5 + 1 });
    if (index === 2) void updateBookmark(active, { hidden: active.hidden ? 0 : 1 });
    if (index === 3) void visit(active);
    if (index === 4) setPanel(null);
  };
  const navigateList = (direction: -1 | 1) => {
    const index = focus.index;
    const next = () => setFocus(direction === -1 && index === 0
      ? { area: 'toolbar', index: 1 }
      : { area: 'list', index: Math.max(0, Math.min(visible.length - 1, index + direction)) });
    const row = itemViews.current.get(visible[index]?.id);
    if (!row || !listViewport.current) { next(); return; }
    // A title can be taller than the entire TV viewport. Read the remaining
    // lines with the D-pad before moving to the next bookmark.
    row.measureInWindow((_x, top, _w, rowHeight) => {
      listViewport.current?.measureInWindow((_vx, viewportTop, _vw, viewportHeight) => {
        if (selectedIndex.current !== index) return;
        const remainder = direction === 1 ? top + rowHeight - viewportTop - viewportHeight : viewportTop - top;
        if (rowHeight > viewportHeight && remainder > 3) {
          const offset = Math.max(0, listOffset.current + direction * Math.min(remainder, viewportHeight * 0.7));
          listOffset.current = offset;
          list.current?.scrollToOffset({ offset, animated: false });
        } else next();
      });
    });
  };
  const onRemote = (key: RemoteKey) => {
    if (logsOpen) { logsRemote.current?.(key); return; }
    diagnostic('remote', { key, focus, panel, locked: locked.current });
    if (key === 'menu' && (locked.current || !ready)) { setLogsOpen(true); return; }
    scrollWithFocus.current = true;
    if (key === 'back') {
      if (busy) return;
      if (notice) { setNotice(null); return; }
      if (panel) { setPanel(null); return; }
      if (Platform.OS === 'android') BackHandler.exitApp();
      return;
    }
    if (!ready) { if (startupError && key === 'select') void initialize(); return; }
    if (locked.current) return;
    if (panel) {
      const count = panel === 'bookmark' ? 5 : panelItems.length;
      if (key === 'up') setPanelIndex(i => Math.max(0, i - 1));
      if (key === 'down') setPanelIndex(i => Math.min(count - 1, i + 1));
      if (panel === 'bookmark' && panelIndex === 1 && active && (key === 'left' || key === 'right')) {
        void updateBookmark(active, { rating: Math.max(1, Math.min(5, (active.rating ?? (key === 'right' ? 0 : 2)) + (key === 'right' ? 1 : -1))) });
      }
      if (key === 'select') menuAction(panelIndex);
      return;
    }
    if (focus.area === 'toolbar') {
      if (key === 'left') setFocus({ area: 'toolbar', index: Math.max(0, focus.index - 1) });
      if (key === 'right') setFocus({ area: 'toolbar', index: Math.min(toolbar.length - 1, focus.index + 1) });
      if (key === 'down' && visible.length) setFocus({ area: 'list', index: 0 });
      if (key === 'select') toolbar[focus.index]?.action();
    } else {
      if (key === 'up') navigateList(-1);
      if (key === 'down') navigateList(1);
      if (key === 'left') setFocus({ area: 'toolbar', index: 1 });
      const bookmark = visible[focus.index];
      if (!bookmark) return;
      if (key === 'select') void visit(bookmark);
      if (key === 'longSelect' || key === 'menu' || key === 'right') openBookmarkMenu(bookmark);
    }
  };
  const remoteHandler = useRef(onRemote);
  remoteHandler.current = onRemote;
  useEffect(() => subscribeRemote(key => remoteHandler.current(key)), []);
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { remoteHandler.current('back'); return true; });
    return () => sub.remove();
  }, []);

  const toolbarButton = (index: number, mini = false) => {
    const item = toolbar[index];
    const focused = !panel && focus.area === 'toolbar' && focus.index === index;
    const disabled = (!!busy && index !== 7) || (index === 3 && prefs.fontSize === 20) || (index === 4 && prefs.fontSize === 38);
    return <Pressable key={index} testID={`toolbar-${index}`} accessibilityLabel={item.label}
      accessibilityRole="button" accessibilityState={{ disabled, selected: focused }} disabled={disabled}
      onFocus={() => pointerFocus({ area: 'toolbar', index })}
      onPress={() => { pointerFocus({ area: 'toolbar', index }); item.action(); }}
      style={({ pressed }) => [s.tool, mini && s.miniTool, index === 0 && s.importButton, focused && s.focused, index === 0 && focused && { backgroundColor: c.primary, borderColor: c.text }, pressed && s.pressed, disabled && s.disabled]}>
      <Icon name={item.icon} size={index === 0 ? 24 : 19} color={index === 0 ? c.background : focused ? c.primary : c.muted} />
      {!mini && <Text style={[s.toolLabel, compactToolbar && { fontSize: 14 }, index === 0 && s.importText]}>{index === 0 ? 'Importa' : item.label}</Text>}
      {[1, 2].includes(index) && <Icon name="chevron-down" size={14} />}
    </Pressable>;
  };

  if ((!fontsLoaded && !fontError) || !ready) return <View style={s.loading}>
    <StatusBar hidden />
    {startupError ? <><Text style={s.dialogTitle}>Archivio non disponibile</Text><Text style={s.subtitle}>{startupError}</Text>
      <Pressable onPress={() => void initialize()} style={[s.tool, s.focused]}><Text style={s.toolLabel}>Riprova</Text></Pressable></>
      : <><ActivityIndicator color={c.primary} size="large" /><Text style={s.subtitle}>Apertura di Bookmark…</Text></>}
    <Pressable accessibilityRole="button" accessibilityLabel="Log" onPress={() => setLogsOpen(true)} style={s.tool}><Text style={s.toolLabel}>Log · {appInfo.version} · build {appInfo.build}</Text></Pressable>
    {logsOpen && <LogViewer onClose={() => setLogsOpen(false)} remote={logsRemote} />}
  </View>;

  return <View style={s.root}>
    <StatusBar hidden />
    <View testID="appbar" style={[s.toolbar, compactToolbar && { gap: 7 }]}>
      {toolbarButton(0, iconToolbar)}{toolbarButton(1, iconToolbar)}{toolbarButton(2, iconToolbar)}
      <View style={s.fontControl}>{toolbarButton(3, true)}<Text accessibilityLabel={`Dimensione testo ${prefs.fontSize}`} style={s.fontLabel}>Aa</Text>{toolbarButton(4, true)}</View>
      {toolbarButton(5, compactToolbar)}{toolbarButton(6, compactToolbar)}{toolbarButton(7)}
      <View style={{ flex: 1 }} />
      <View style={{ alignItems: 'flex-end', gap: 2 }}>
      <View testID="bookmark-count" accessibilityLabel={`${visible.length} segnalibri`} style={s.collectionStats}>
        {iconToolbar && <Icon name="bookmarks-outline" size={18} />}
        <Text style={s.statNumber}>{visible.length}</Text>
        {!iconToolbar && <Text style={s.statLabel}>segnalibri</Text>}
      </View>
      <Text testID="app-version" style={{ color: c.muted, fontSize: 11 }}>v{appInfo.version} · #{appInfo.build}</Text>
      </View>
    </View>
    <View ref={listViewport} testID="bookmark-list" style={{ flex: 1 }} collapsable={false}>
      <FlatList ref={list} data={visible} keyExtractor={item => item.id} style={s.list}
        onScroll={e => { listOffset.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}
        contentContainerStyle={[s.listContent, !visible.length && { flexGrow: 1 }]} extraData={[focus, panel, prefs.fontSize]}
        initialNumToRender={12} maxToRenderPerBatch={16} windowSize={7}
        onScrollToIndexFailed={({ index, averageItemLength }) => {
          list.current?.scrollToOffset({ offset: Math.max(0, averageItemLength * index), animated: false });
          if (scrollRetry.current) clearTimeout(scrollRetry.current);
          scrollRetry.current = setTimeout(() => {
            if (scrollWithFocus.current && selectedIndex.current >= 0) list.current?.scrollToIndex({ index: selectedIndex.current, animated: false, viewPosition: 0 });
          }, 100);
        }}
        ListEmptyComponent={<View style={s.empty}>
          <Text style={s.emptyTitle}>{bookmarks.length ? 'Nessun segnalibro in questa vista' : 'Nessun segnalibro'}</Text>
          <Text style={s.emptyText}>{bookmarks.length ? 'Cambia il filtro o mostra i segnalibri nascosti dalla barra in alto.' : 'Seleziona Importa per aprire un file HTML esportato da Firefox.'}</Text>
        </View>}
        renderItem={({ item, index }) => {
          const selected = !panel && focus.area === 'list' && focus.index === index;
          return <View ref={view => { if (view) itemViews.current.set(item.id, view); else itemViews.current.delete(item.id); }} collapsable={false}
            style={[s.bookmark, compact && { paddingVertical: 17, paddingHorizontal: 16, gap: 14 }, selected && s.bookmarkSelected]}>
            <Pressable testID={`bookmark-${index}`} accessibilityRole="button"
            accessibilityLabel={`${item.title}. ${item.seen ? 'Visto' : 'Da vedere'}. ${item.rating ? `${item.rating} stelle` : 'Non valutato'}${item.hidden ? '. Nascosto' : ''}`}
            accessibilityHint="Premi per aprire. Tieni premuto per gestire il segnalibro."
            accessibilityState={{ selected }} aria-selected={selected} disabled={!!busy || !!panel}
            onFocus={() => pointerFocus({ area: 'list', index })}
            onPress={() => { pointerFocus({ area: 'list', index }); void visit(item); }}
            onLongPress={() => { pointerFocus({ area: 'list', index }); openBookmarkMenu(item); }} delayLongPress={550}
            style={({ pressed }) => [s.bookmarkAction, compact && { gap: 14 }, pressed && s.pressed]}>
            <View style={[s.bookmarkSymbol, selected && { backgroundColor: c.primary }]}><Icon name={selected ? 'play' : 'bookmark-outline'} color={selected ? c.background : c.dim} size={selected ? 23 : 25} /></View>
            <View style={s.bookmarkBody}>
              <Text style={[s.bookmarkTitle, { fontSize: prefs.fontSize, lineHeight: Math.ceil(prefs.fontSize * 1.35) }]}>{item.title}</Text>
              <View style={s.metadata}>
                <View style={s.status}><Icon name={item.seen ? 'checkmark-circle' : 'ellipse-outline'} size={14} color={item.seen ? c.green : c.primary} /><Text style={[s.metadataText, { color: item.seen ? c.green : c.primary }]}>{item.seen ? 'Visto' : 'Da vedere'}</Text></View>
                <Text style={s.metadataDot}>·</Text><Text style={s.metadataText}>{date(item.importedAt)}</Text>
                {!!item.hidden && <View style={s.hiddenBadge}><Icon name="eye-off-outline" size={12} color={c.secondary} /><Text style={s.hiddenText}>Nascosto</Text></View>}
              </View>
            </View>
            <View style={s.ratingColumn}><Stars rating={item.rating} size={compact ? 17 : 20} /><Text style={s.ratingCaption}>{item.rating ? `${item.rating}.0 / 5` : 'Da valutare'}</Text></View>
            </Pressable>
            <Pressable testID={`menu-${index}`} accessibilityRole="button" accessibilityLabel={`Gestisci ${item.title}`}
              onPress={event => { event.stopPropagation(); pointerFocus({ area: 'list', index }); openBookmarkMenu(item); }} style={s.moreButton}>
              <Icon name="ellipsis-vertical" color={selected ? c.primary : c.dim} size={22} />
            </Pressable>
          </View>;
        }} />
    </View>

    {!!panel && <View style={s.overlay}>
      <Pressable style={StyleSheet.absoluteFill} onPress={() => !busy && setPanel(null)} accessibilityLabel="Chiudi menu" />
      <View accessibilityViewIsModal style={[s.dialog, { maxHeight: height - 32, width: Math.min(800, width - 48) }]}>
        <View style={s.dialogHeader}>
          <View style={s.dialogGlyph}><Icon name={panel === 'bookmark' ? 'options-outline' : panel === 'sort' ? 'swap-vertical' : panel === 'filter' ? 'filter' : 'globe-outline'} color={c.secondary} size={25} /></View>
          <View style={{ flex: 1 }}><Text style={s.dialogEyebrow}>{panel === 'bookmark' ? 'MENU CONTESTUALE' : 'PERSONALIZZA LA TUA RACCOLTA'}</Text><Text style={s.dialogTitle}>{panel === 'bookmark' ? 'Gestisci segnalibro' : panel === 'sort' ? 'Ordina per' : panel === 'filter' ? 'Stato di visione' : 'Browser per i segnalibri'}</Text></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Chiudi menu" onPress={() => setPanel(null)} style={s.closeButton}><Icon name="close" /></Pressable>
        </View>
        <ScrollView ref={panelScroll} style={{ flexShrink: 1 }} contentContainerStyle={s.dialogBody}>
          {panel === 'bookmark' && active && <>
            <Text style={[s.dialogBookmarkTitle, { fontSize: Math.min(prefs.fontSize, 30), lineHeight: Math.min(prefs.fontSize, 30) * 1.35 }]}>{active.title}</Text>
            <View style={s.dialogDivider} />
            {[
              { icon: 'checkmark-circle-outline', title: 'Stato di visione', description: `Attualmente impostato su: ${active.seen ? 'Visto' : 'Da vedere'}` },
              { icon: 'star', title: 'Assegna valutazione', description: 'Usa ← → per cambiare il punteggio' },
              { icon: active.hidden ? 'eye-outline' : 'eye-off-outline', title: active.hidden ? 'Riattiva segnalibro' : 'Nascondi segnalibro', description: active.hidden ? 'Riporta il segnalibro nella raccolta' : 'Rimuovi dalla vista principale, senza eliminarlo' },
              { icon: 'open-outline', title: 'Apri nel browser', description: prefs.browser ? 'Usa il browser scelto per questa app' : 'Usa il browser predefinito del dispositivo' },
            ].map((row, index) => <Pressable key={index} testID={`action-${index}`} accessibilityRole={index === 1 ? 'adjustable' : 'button'} accessibilityLabel={row.title}
              accessibilityValue={index === 1 ? { min: 1, max: 5, now: active.rating ?? 1, text: active.rating ? `${active.rating} stelle` : 'Non valutato' } : undefined}
              accessibilityActions={index === 1 ? [{ name: 'increment' }, { name: 'decrement' }] : undefined}
              onAccessibilityAction={event => {
                if (index === 1) void updateBookmark(active, { rating: Math.max(1, Math.min(5, (active.rating ?? 0) + (event.nativeEvent.actionName === 'increment' ? 1 : -1))) });
              }}
              onLayout={e => { panelPositions.current[index] = e.nativeEvent.layout.y; }}
              onFocus={() => setPanelIndex(index)} onPress={() => { setPanelIndex(index); menuAction(index); }} disabled={!!busy}
              style={[s.menuRow, panelIndex === index && s.focused, index === 1 && { flexWrap: 'wrap' }]}>
              <Icon name={row.icon as IconName} color={index === 1 ? c.yellow : c.primary} size={22} />
              <View style={{ flex: 1, minWidth: 200 }}><Text style={s.menuTitle}>{row.title}</Text><Text style={[s.menuDescription, index === 1 && { color: c.primary }]}>{row.description}</Text></View>
              {index === 0 ? <View style={[s.toggle, !!active.seen && { backgroundColor: '#4946CE' }]}><View style={[s.toggleKnob, !!active.seen && { alignSelf: 'flex-end', backgroundColor: c.primary }]} /></View>
                : index === 1 ? <View style={s.ratingPicker}>{[1, 2, 3, 4, 5].map(value => <Pressable key={value} accessibilityRole="button" accessibilityLabel={`Assegna ${value} stelle`} onPress={e => { e.stopPropagation(); setPanelIndex(1); void updateBookmark(active, { rating: value }); }} style={s.starButton}><Icon name={value <= (active.rating ?? 0) ? 'star' : 'star-outline'} color={c.yellow} size={25} /></Pressable>)}</View>
                  : <Icon name={index === 3 ? 'open-outline' : 'chevron-forward'} size={19} />}
            </Pressable>)}
            <Pressable onLayout={e => { panelPositions.current[4] = e.nativeEvent.layout.y; }} accessibilityRole="button" onFocus={() => setPanelIndex(4)} onPress={() => setPanel(null)} style={[s.closeMenu, panelIndex === 4 && s.focused]}><Text style={s.toolLabel}>Chiudi menu</Text></Pressable>
          </>}
          {panel !== 'bookmark' && panelItems.map((item, index) => <Pressable key={item.label} accessibilityRole="radio" accessibilityState={{ checked: item.checked }} aria-checked={item.checked} accessibilityLabel={item.label}
            onLayout={e => { panelPositions.current[index] = e.nativeEvent.layout.y; }} onFocus={() => setPanelIndex(index)} onPress={item.action} style={[s.menuRow, panelIndex === index && s.focused]}>
            <Icon name={item.icon} color={c.primary} /><View style={{ flex: 1 }}><Text style={s.menuTitle}>{item.label}</Text><Text style={s.menuDescription}>{item.description}</Text></View><Icon name={item.checked ? 'radio-button-on' : 'radio-button-off'} color={item.checked ? c.primary : c.dim} />
          </Pressable>)}
          {panel === 'browser' && Platform.OS === 'web' && <Text style={s.menuDescription}>Nell’anteprima web i link si aprono in una nuova scheda. La scelta del browser è disponibile nell’app Android.</Text>}
        </ScrollView>
        <View style={s.dialogFooter}><Hint keys="Indietro" label="Chiudi" /><Hint keys="OK" label={panel === 'bookmark' ? 'Applica' : 'Seleziona'} /><View style={{ flex: 1 }} /><Text style={s.autosave}>Salvataggio automatico</Text></View>
      </View>
    </View>}
    {!!busy && <View pointerEvents="auto" style={s.busyOverlay}><View style={s.busyCard}><ActivityIndicator color={c.primary} /><Text style={s.toolLabel}>{busy}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Log operazione" onPress={() => setLogsOpen(true)} style={s.tool}><Text style={s.toolLabel}>Log (Menu)</Text></Pressable>
    </View></View>}
    {!!notice && <Pressable accessibilityRole="alert" accessibilityLiveRegion="polite" onPress={() => setNotice(null)} style={[s.notice, notice.error && { borderColor: c.danger }]}><Icon name={notice.error ? 'alert-circle-outline' : 'checkmark-circle'} color={notice.error ? c.danger : c.green} /><Text style={s.noticeText}>{notice.text}</Text><Icon name="close" size={18} /></Pressable>}
    {logsOpen && <LogViewer onClose={() => setLogsOpen(false)} remote={logsRemote} />}
  </View>;
}

function Hint({ keys, label }: { keys: string; label: string }) {
  return <View style={s.hint}><Text style={s.keyCap}>{keys}</Text><Text style={s.hintLabel}>{label}</Text></View>;
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: c.background, paddingHorizontal: 16, paddingTop: 12 },
  loading: { flex: 1, backgroundColor: c.background, alignItems: 'center', justifyContent: 'center', padding: 40, gap: 24 },
  subtitle: { color: c.muted, fontSize: 15, marginTop: 9, lineHeight: 23 },
  collectionStats: { flexDirection: 'row', gap: 6, alignItems: 'center', flexShrink: 0 },
  statNumber: { color: c.text, fontSize: 20, fontWeight: '600' },
  statLabel: { color: c.muted, fontSize: 14 },
  toolbar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 10, marginBottom: 10, borderBottomWidth: 1, borderBottomColor: c.border },
  tool: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, borderRadius: 8, paddingVertical: 10, paddingHorizontal: 13, backgroundColor: c.panel, borderWidth: 2, borderColor: c.border },
  toolLabel: { fontSize: 15, color: c.text, fontWeight: '500' },
  importButton: { backgroundColor: c.primary, borderColor: c.primary, paddingHorizontal: 18 },
  importText: { color: c.background, fontWeight: '700' },
  miniTool: { paddingHorizontal: 10, minWidth: 42 },
  focused: { borderColor: c.primary, backgroundColor: c.primarySoft, borderWidth: 2 },
  pressed: { opacity: 0.78 }, disabled: { opacity: 0.4 },
  fontControl: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fontLabel: { fontSize: 19, color: c.muted, paddingHorizontal: 2 },
  list: { flex: 1 }, listContent: { paddingBottom: 10 },
  bookmark: { flexDirection: 'row', alignItems: 'center', backgroundColor: c.panel, borderRadius: 13, borderWidth: 2, borderColor: '#1F2B40', paddingHorizontal: 22, paddingVertical: 23, marginBottom: 11, gap: 21 },
  bookmarkSelected: { borderColor: c.primary, backgroundColor: '#122438' },
  bookmarkAction: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 21 },
  bookmarkSymbol: { backgroundColor: c.elevated, width: 46, height: 50, borderRadius: 11, justifyContent: 'center', alignItems: 'center' },
  bookmarkBody: { flex: 1, minWidth: 0 },
  bookmarkTitle: { color: c.text, fontWeight: '600', flexShrink: 1, letterSpacing: -0.25 },
  metadata: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: 10, rowGap: 6, marginTop: 11 },
  status: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  metadataText: { color: c.muted, fontSize: 12 }, metadataDot: { color: c.dim },
  hiddenBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#252241', paddingVertical: 3, paddingHorizontal: 6, borderRadius: 4 },
  hiddenText: { color: '#BCB9FF', fontSize: 11 },
  stars: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  ratingColumn: { alignItems: 'center', gap: 8 }, ratingCaption: { color: c.dim, fontSize: 12 },
  moreButton: { minWidth: 38, minHeight: 46, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 25, gap: 15 },
  emptyTitle: { fontSize: 24, color: c.text, fontWeight: '600', textAlign: 'center' },
  emptyText: { fontSize: 16, color: c.muted, lineHeight: 25, textAlign: 'center' },
  hint: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  keyCap: { color: c.muted, fontSize: 11, fontWeight: '700', borderWidth: 1, borderColor: '#3B4960', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 3 },
  hintLabel: { color: c.dim, fontSize: 12 },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: '#03060DCF', justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  dialog: { backgroundColor: '#141D30', borderWidth: 1.5, borderColor: c.primary, borderRadius: 20, padding: 24 },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', gap: 15, marginBottom: 20 },
  dialogGlyph: { backgroundColor: '#292552', borderRadius: 13, width: 48, height: 48, justifyContent: 'center', alignItems: 'center' },
  dialogEyebrow: { color: c.primary, fontSize: 10, letterSpacing: 1.5, fontWeight: '700', marginBottom: 6 },
  dialogTitle: { color: c.text, fontSize: 24, fontWeight: '700' },
  closeButton: { padding: 10 }, dialogBody: { gap: 10, paddingBottom: 3 },
  dialogBookmarkTitle: { color: c.text, fontWeight: '600' },
  dialogDivider: { height: 1, backgroundColor: c.border, marginVertical: 9 },
  menuRow: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#202C40', borderWidth: 2, borderColor: '#2B364B', borderRadius: 11, paddingHorizontal: 16, paddingVertical: 13, minHeight: 68 },
  menuTitle: { color: c.text, fontWeight: '600', fontSize: 19 },
  menuDescription: { color: c.muted, fontSize: 13, lineHeight: 19, marginTop: 3 },
  toggle: { width: 46, height: 26, backgroundColor: '#455168', borderRadius: 20, padding: 3 },
  toggleKnob: { width: 20, height: 20, borderRadius: 10, backgroundColor: c.muted },
  ratingPicker: { flexDirection: 'row', backgroundColor: c.background, borderRadius: 10, paddingHorizontal: 5 },
  starButton: { paddingHorizontal: 4, paddingVertical: 9 },
  closeMenu: { alignSelf: 'flex-start', paddingHorizontal: 20, paddingVertical: 10, borderWidth: 2, borderColor: c.border, borderRadius: 8, marginTop: 5 },
  dialogFooter: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 19, borderTopWidth: 1, borderTopColor: c.border, paddingTop: 15 },
  autosave: { color: c.dim, fontSize: 11 },
  busyOverlay: { ...StyleSheet.absoluteFill, zIndex: 20, backgroundColor: '#090D1877', justifyContent: 'center', alignItems: 'center' },
  busyCard: { backgroundColor: c.elevated, paddingHorizontal: 28, paddingVertical: 23, borderRadius: 15, gap: 15, flexDirection: 'row', alignItems: 'center' },
  notice: { position: 'absolute', bottom: 16, left: 24, right: 24, backgroundColor: '#223047', borderWidth: 1, borderColor: c.green, borderRadius: 10, padding: 17, gap: 12, flexDirection: 'row', alignItems: 'center', zIndex: 30 },
  noticeText: { color: c.text, fontSize: 16, lineHeight: 23, flex: 1 },
});
