#!/bin/bash

# find blackhone device id
AUDIO_DEVICE_ID=$(ffmpeg -f avfoundation -list_devices true -i '' 2>&1 > /dev/null | grep BlackHole | sed -Ee 's/(.*\[)([0-9])(\].*)/\2/g')

# run server
ffmpeg -loglevel quiet -f avfoundation -i :$AUDIO_DEVICE_ID -ac 1 -c:a pcm_s16le -ar 16000 -f wav - | node index.js
