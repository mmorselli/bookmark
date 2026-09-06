# OBBIETTIVO

creare una App Android di gestione Bookmark (url)

# AMBIENTE DI SVILUPPO

- react native
- fare riferimento al progetto /home/massimo/prg/passport-app per le configurazioni di ambiente, es. posizione di Android SDK o script di compilazione apk

# DESCRIZIONE

- L'applicazione conterrà un semplice elenco di bookmark statico, importato da un file html esportato da Firefox, un esempio di file si trova in sample/bookmarks.html
- il file sarà importato nel database locale dell'applicazione, l'indice sarà l'hash della url in modo da poter riconoscere url già importate
- dal file saranno importati url, titolo, data prima importazione
- sarà usato in un televisore, privilegiare quindi colori e font ben visibili a distanza e il formato landscape

# FUNZIONALITÀ

- l'elenco mostrerà il titolo, non il link, andando a capo se troppo lungo per la dimensione del font, non deve essere troncato.
- oltre al titolo mostrerà il rating da 1-5 con delle stelline gialle
- l'elenco bookmark si deve poter scorrere anche con i tasti cursore della tastiera
- premendo su un bookmark deve aprirsi il browser predefinito per l'app su quell'indirizzo e il bookmark è markato nel db come visto
- long press su un bookmark deve aprire un menu che consente di:
-- segnare come visto / non visto
-- assegnare un rating da 1 a 5
-- nascondere/riattivare un bookmark


# APPBAR

questa le funzionalità che dovranno essere presenti in appbar

- importa il file dal filesystem locale
- ordinamento per: alfabetico ASC, visto/non visto (filtro), data importazione (DESC), rating (DESC)
- dimensione font (ingandisci / rimpicciolisci)
- mostra/nasconti bookmark nascosti