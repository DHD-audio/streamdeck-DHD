#!/bin/sh

#this script works mac only!
#we use it as the symlink approach sometime is not working properly

# Shoot stream deck app
pkill -x "Stream Deck"

sleep 1  # Waits 1 second.

# Simply remove the old folder in streamdeck's plugin folder and replace by current one. Has to be replaced by own path.
rm -r "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/audio.dhd.s52.sdPlugin"

cp -a src/audio.dhd.s52.sdPlugin/ "$HOME/Library/Application Support/com.elgato.StreamDeck/Plugins/audio.dhd.s52.sdPlugin"

#launch stream deck app
open -a "Elgato Stream Deck"