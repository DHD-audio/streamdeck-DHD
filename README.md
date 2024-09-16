# RM1 Stream Deck Plugin

A Stream Deck Plugin to control RM1 by DHD audio. It uses DHD's control API via WebSocket.

It also serves as a code sample for developers interested in implementing DHD's control API.

## Supported Actions

Supported actions are:
* Channel On/Off
* PFL On/Off
* HP1/HP2/Out volume on encoder (SD+)

## Get started

- Install the plugin.
- Configure any action and click the 'Configure RM1 Connection'.
- Enter the RM1 hostname or IP address and click save. The values are globally stored for each action.

## How it works

FIXME

## Contributing

Follow the documentation of the [Stream Deck SDK](https://docs.elgato.com/sdk/) to get started developing the plugin. Then clone the repository to your machine and install the required streamdeck library submodule using `git submodule update --init --recursive`.

If you have added new features or fixed bugs, feel free to create a pull request.