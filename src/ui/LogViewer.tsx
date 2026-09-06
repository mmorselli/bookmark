import React, { useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { appInfo, diagnostic, exportDiagnostics, readDiagnostics } from '../platform/diagnostics';
import type { LogSnapshot } from '../platform/diagnostics';
import type { RemoteKey } from '../platform/device';
import { colors as c } from './theme';

export function LogViewer({ onClose, remote }: { onClose(): void; remote: MutableRefObject<((key: RemoteKey) => void) | null> }) {
  const [snapshot, setSnapshot] = useState<LogSnapshot | null>(null);
  const [message, setMessage] = useState('');
  const [focused, setFocused] = useState(0);
  const focusedButton = useRef(0);
  const focusButton = (index: number) => { focusedButton.current = index; setFocused(index); };
  const [saving, setSaving] = useState(false);
  const scroll = useRef<ScrollView>(null);
  const offset = useRef(0);
  const viewport = useRef(0);
  const contentHeight = useRef(0);
  const followEnd = useRef(true);
  const error = (e: unknown) => setMessage(e instanceof Error ? e.message : String(e));
  const refresh = async () => { try { followEnd.current = true; setSnapshot(await readDiagnostics()); } catch (e) { error(e); } };
  const save = async () => {
    if (saving) return;
    setSaving(true);
    try { setMessage(`Log salvato: ${await exportDiagnostics()}`); } catch (e) { error(e); }
    finally { setSaving(false); }
  };
  useEffect(() => { diagnostic('log.open'); void refresh(); }, []);
  const buttons = [
    { label: 'Aggiorna', action: () => { diagnostic('log.refresh'); void refresh(); } },
    { label: saving ? 'Salvataggio…' : 'Salva in Download', action: () => void save() },
    { label: 'Chiudi', action: onClose },
  ];
  remote.current = key => {
    if (key === 'back') onClose();
    if (key === 'left') focusButton(Math.max(0, focusedButton.current - 1));
    if (key === 'right') focusButton(Math.min(2, focusedButton.current + 1));
    if (key === 'select') buttons[focusedButton.current].action();
    if (key === 'up' || key === 'down') {
      offset.current = Math.max(0, Math.min(Math.max(0, contentHeight.current - viewport.current), offset.current + (key === 'up' ? -1 : 1) * viewport.current * 0.75));
      scroll.current?.scrollTo({ y: offset.current, animated: false });
    }
  };
  useEffect(() => () => { remote.current = null; }, [remote]);
  return <View testID="log-viewer" accessibilityViewIsModal style={s.root}>
    <Text style={s.title}>Log · Bookmark {appInfo.version} · build {appInfo.build}</Text>
    <Text style={s.info}>{appInfo.device}</Text>
    <View style={s.buttons}>{buttons.map((button, index) => <Pressable key={index} testID={`log-action-${index}`} accessibilityRole="button" accessibilityLabel={button.label}
      accessibilityState={{ selected: focused === index }} aria-selected={focused === index}
      onFocus={() => focusButton(index)} onPress={() => { focusButton(index); button.action(); }} style={[s.button, focused === index && s.focused]}>
      <Text style={s.label}>{button.label}</Text>
    </Pressable>)}</View>
    <Text style={s.info}>↑ ↓ scorri il log · ← → scegli il pulsante · OK esegui · Indietro chiudi</Text>
    {!!message && <Text testID="log-message" accessibilityLiveRegion="polite" style={s.message}>{message}</Text>}
    {!!snapshot?.writeError && <Text style={s.message}>{snapshot.writeError}</Text>}
    <ScrollView ref={scroll} testID="log-scroll" style={s.scroll}
      onLayout={e => { viewport.current = e.nativeEvent.layout.height; }}
      onContentSizeChange={(_, height) => {
        contentHeight.current = height;
        if (followEnd.current) { followEnd.current = false; offset.current = Math.max(0, height - viewport.current); scroll.current?.scrollToEnd({ animated: false }); }
      }}
      onScroll={e => { offset.current = e.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}>
      <Text testID="log-text" selectable style={s.log}>{snapshot?.text || 'Caricamento log…'}</Text>
    </ScrollView>
    <Text style={s.info}>{snapshot?.truncated === 'true' ? 'Ultimi 60.000 caratteri. Salva in Download per il log completo.' : snapshot?.filePath ?? ''}</Text>
  </View>;
}

const s = StyleSheet.create({
  root: { ...StyleSheet.absoluteFill, zIndex: 50, backgroundColor: c.background, padding: 18, gap: 8 },
  title: { color: c.text, fontSize: 22, fontWeight: '700' },
  info: { color: c.muted, fontSize: 12 },
  buttons: { flexDirection: 'row', gap: 12 },
  button: { paddingHorizontal: 16, paddingVertical: 10, backgroundColor: c.panel, borderColor: c.border, borderWidth: 2, borderRadius: 8 },
  focused: { borderColor: c.primary, backgroundColor: c.primarySoft },
  label: { color: c.text, fontSize: 16 },
  scroll: { flex: 1, backgroundColor: c.panel, padding: 10, borderRadius: 8 },
  log: { color: c.text, fontFamily: 'monospace', fontSize: 14, lineHeight: 21, paddingBottom: 24 },
  message: { color: c.primary, fontSize: 15 },
});
