# homebridge-netcast-tv

Homebridge plugin for interacting with LG Netcast-based TVs (2012, 2013).

> **Fork note**: This is a modernized fork of [dvcrn/homebridge-netcast-tv](https://github.com/dvcrn/homebridge-netcast-tv), updated for Homebridge 2.x and the current verified plugin requirements.

- [Installation](#installation)
- [Setup](#setup)
- [Configuration](#configuration)
    - [Regarding channels](#regarding-channels)
    - [Example config](#example-config)
- [Caveats](#caveats)
    - [Turning on the TV](#turning-on-the-tv)
    - [Switching between HDMI and TV](#switching-between-hdmi-and-tv)
- [What is working](#what-is-working)

## Installation

```
npm install -g homebridge-netcast-tv
```

Or search for "Netcast TV" in the Homebridge UI plugins tab.

TVs are exposed as separate accessories that need manual pairing. After adding this plugin, check your log files for the pairing code:

```
[11/24/2020, 8:29:52 PM] LG TV is running on port 60335.
[11/24/2020, 8:29:52 PM] Please add [LG TV] manually in Home app. Setup Code: 618-65-640
```

## Setup

To pair with the TV, you need to get it to display a valid access token.

This repository also comes with a `netcast-cli` helper tool that you can use to query the TV:

```
netcast-cli --command access_token --host 192.168.1.6
```

**Note**: The default port is `:8080`. Not specifying a port will use the default.

## Configuration

You can configure this plugin through the Homebridge UI Settings panel, or manually in your `config.json`:

```json
"platforms": [
    {
        "platform": "netcasttv",
        "devices": [
            {
                "name": "LG TV",
                "host": "192.168.1.14",
                "mac": "cc:2d:8c:a4:4a:d6",
                "accessToken": "xxxxx",
                "keyInputDelay": 600,
                "offPauseDuration": 600000,
                "channels": []
            }
        ]
    }
]
```

- `name`: Name of the accessory
- `host`: IP of your TV
- `mac`: MAC address of the TV
- `accessToken`: Pair code of the TV
- `model`: (optional) Model name shown in HomeKit accessory info
- `keyInputDelay`: Delay in ms to wait before issuing repeated key presses (such as switching input source)
- `offPauseDuration`: Delay in ms to pause polling for TV status after turning off. This is needed because the TV still responds to channel query requests when it has been turned off
- `channels`: List of channels that are available

### Regarding channels

To identify the current channel, use the `netcast-cli` helper tool:

```
❯ netcast-cli --host 192.168.1.14:8080 --access_token xxxxx
Querying current channel
{
  chtype: 'terrestrial',
  sourceIndex: '1',
  physicalNum: '21',
  major: '81',
  displayMajor: '81',
  minor: '65535',
  displayMinor: '-1',
  chname: 'フジテレビ',
  progName: '...',
  audioCh: '0',
  inputSourceName: 'TV',
  inputSourceType: '0',
  labelName: {},
  inputSourceIdx: '0'
}
```

**For HDMI devices**: Specify only `inputSourceType` and `inputSourceIdx`. Set `type` to `"external"`.

**For channels**: Specify `type` = `"tv"` and include `sourceIndex`, `physicalNum`, `major`, `minor`, `inputSourceType`, and `inputSourceIdx`.

### Example config

```json
"platforms": [
    {
        "platform": "netcasttv",
        "devices": [
            {
                "name": "LG TV",
                "host": "192.168.1.14",
                "mac": "cc:2d:8c:a4:4a:d6",
                "accessToken": "xxxxx",
                "keyInputDelay": 600,
                "offPauseDuration": 600000,
                "channels": [
                    {
                        "name": "AppleTV",
                        "type": "external",
                        "channel": {
                            "inputSourceType": "6",
                            "inputSourceIdx": "3"
                        }
                    },
                    {
                        "name": "Chromecast",
                        "type": "external",
                        "channel": {
                            "inputSourceType": "6",
                            "inputSourceIdx": "4"
                        }
                    },
                    {
                        "name": "Nihon TV",
                        "type": "tv",
                        "channel": {
                            "sourceIndex": "1",
                            "physicalNum": "25",
                            "major": "41",
                            "minor": "65535",
                            "inputSourceType": "0",
                            "inputSourceIdx": "0"
                        }
                    }
                ]
            }
        ]
    }
]
```

## Caveats

### Turning on the TV

This is **not** supported. It's not possible through the Netcast API nor Wake-on-LAN. As a workaround, use automations and HDMI CEC through LG Simplink. Setting the TV state to "on" in HomeKit won't turn on the hardware — it only updates the state.

For example, use an AppleTV or Chromecast, and turn it on when the TV state turns to "on". ([homebridge-apple-tv-remote](https://www.npmjs.com/package/homebridge-apple-tv-remote) works well for this.)

### Switching between HDMI and TV

This is also **not** directly supported through the Netcast API. The workaround this plugin uses is to open the input source menu, then send LEFT/RIGHT arrow keys, then hit "OK". That's why the `inputSourceIdx` key is needed for everything.

To change the interval between key presses, adjust the `keyInputDelay` config key. For slower TV UIs, try 600–1000ms.

## What is working

- Turning the TV off
- Switching channels
- Displaying current channel
- Switching between HDMI/TV through the workaround above
- Controlling the TV through the remote API
- Changing volume

## Credits

Powered by [lg-netcast](https://github.com/dvcrn/lg-netcast).
Original plugin by [dvcrn](https://github.com/dvcrn).
