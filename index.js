const { TranscribeStreamingClient, StartStreamTranscriptionCommand } = require('@aws-sdk/client-transcribe-streaming');
const { TranslateClient, TranslateTextCommand } = require("@aws-sdk/client-translate");
const stream = require('stream');
const express = require('express');
const ws = require('ws');
const proc = require('child_process')

/* config */
// debug
const DEV_CONSOLE_OUTPUTS = true;

// audio stream
const passthroughStream = new stream.PassThrough({ highWaterMark: 128 });
const SAMPLE_RATE = 16000;

// transctibe and translate setup
const REGION = 'ap-northeast-2'
const AUDIO_LANGUAGE = 'en-US'
const TRANSLATED_LANGUAGE = 'ko-KR'

// web server
const WEBAPP_PORT = 3000;

/* web server */
const app = express();
app.use(express.static('public'));
app.get('/', (req, res) => {
    res.sendFile(__dirname + '/public/index.html');
});

const wsServer = new ws.Server({ noServer: true });
wsServer.on('connection', socket => {
    console.log(`web socket connected`)
    socket.on('message', message => console.log(message));
});

const server = app.listen(WEBAPP_PORT, () => console.log(`Server listening on port: ${WEBAPP_PORT}`));
server.on('upgrade', (request, socket, head) => {
    wsServer.handleUpgrade(request, socket, head, socket => {
        wsServer.emit('connection', socket, request);
    });
});

const broadcastWssMessage = function (data) {
    wsServer.clients.forEach(function each(client) {
        if (client.readyState === ws.OPEN) {
            const bundle = JSON.stringify(data);
            client.send(bundle, { binary: false });
        }
    });
}

function openBrowser(url) {
    let startCommand = (process.platform == 'darwin' ? 'open' : process.platform == 'win32' ? 'start' : 'xdg-open');
    proc.exec(startCommand + ' ' + url);
}

/* Audio stream data from pipe */
process.stdin
    .on('data', (data) => {
        // this is audio data
        passthroughStream.write(data);
    })
    .on('end', () => {
        // do something when the stream stops
    });

/* Configure Translate */
const client = new TranslateClient({ region: REGION });
const getTranslate = async function (text) {
    const input = {
        Text: text,
        SourceLanguageCode: AUDIO_LANGUAGE,
        TargetLanguageCode: TRANSLATED_LANGUAGE,
    };
    const command = new TranslateTextCommand(input);
    const response = await client.send(command);
    return response.TranslatedText;
};

/* Result output */
const processTranscriptResult = async function (results) {
    for (const res of results) {
        if (!res.Alternatives || res.Alternatives.length == 0) continue;
        
        let text = "";
        for (const alt of res.Alternatives) {
            text += (alt.Transcript + " ")
        }

        let output;
        if (res.IsPartial) {
            output = '\t' + text;
            broadcastWssMessage({
                isPartial: res.IsPartial,
                text: text
            });
        } else {
            translated_text = await getTranslate(text);
            output = text + '\n' + translated_text;
            broadcastWssMessage({
                isPartial: res.IsPartial,
                text: text,
                translated: translated_text
            });
        }

        if(DEV_CONSOLE_OUTPUTS) console.log(output);
    }
}

/* Configure Transcribe */
const audioStream = async function* audioStream() {
    try {
        // eslint-disable-next-line no-restricted-syntax
        for await (const payloadChunk of passthroughStream) {
            yield { AudioEvent: { AudioChunk: payloadChunk } };
        }
    } catch (error) {
        console.log('Error reading passthrough stream or yielding audio chunk.');
    }
};

const startTranscribe = async function startTranscribe() {
    console.log('starting transcribe');
    const tsClient = new TranscribeStreamingClient({ region: REGION });
    const tsParams = {
        LanguageCode: AUDIO_LANGUAGE,
        MediaEncoding: 'pcm',
        MediaSampleRateHertz: SAMPLE_RATE,
        AudioStream: audioStream(),
    };

    const tsCmd = new StartStreamTranscriptionCommand(tsParams);
    const tsResponse = await tsClient.send(tsCmd);
    const tsStream = stream.Readable.from(tsResponse.TranscriptResultStream);

    try {
        for await (const chunk of tsStream) {
            if (chunk.TranscriptEvent.Transcript.Results.length > 0) {
                processTranscriptResult(chunk.TranscriptEvent.Transcript.Results)
            }
        }
    } catch (error) {
        // console.log(error);
        console.log('error writing transcription segment', JSON.stringify(error), error);
    } finally {
        // close streams
        console.log('closing stream');
    }
};

// start transcribing
startTranscribe();
openBrowser('http://localhost:'+WEBAPP_PORT)
