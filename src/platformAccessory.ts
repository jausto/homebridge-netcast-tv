import {
  Service,
  PlatformAccessory,
  CharacteristicValue,
} from 'homebridge';
import { LgNetcastPlatform, DeviceConfig, ChannelType } from './platform';
import { PLUGIN_NAME } from './settings';

import { Channel, NetcastClient, LG_COMMAND } from 'lg-netcast';

export class LgNetcastTV {
  private service: Service;
  private netcastClient: NetcastClient;
  private currentChannel: Channel | null;
  private channelUpdateInProgress: boolean;

  private unknownChannelIdentifier: number;
  private unknownChannelName: string;

  private offTimeout: NodeJS.Timeout | null;
  private offPause: boolean;

  private accessory: PlatformAccessory;

  constructor(private readonly platform: LgNetcastPlatform, private readonly deviceConfig: DeviceConfig) {
    deviceConfig.accessToken = deviceConfig.accessToken || '';
    deviceConfig.name = deviceConfig.name || 'LG TV';
    deviceConfig.host = deviceConfig.host || '192.168.1.1';
    deviceConfig.mac = deviceConfig.mac || '00:00:00:00:00';
    deviceConfig.accessToken = deviceConfig.accessToken || '';
    deviceConfig.channels = deviceConfig.channels || [];
    deviceConfig.keyInputDelay = deviceConfig.keyInputDelay || 600;
    deviceConfig.offPauseDuration = deviceConfig.offPauseDuration || 600000;

    // Append port if needed
    if (deviceConfig.host.indexOf(':') === -1) {
      deviceConfig.host = deviceConfig.host + ':8080';
    }

    for (let i = 0; i < deviceConfig.channels.length; i++) {
      deviceConfig.channels[i].name = deviceConfig.channels[i].name || 'Unnamed Channel';

      if ([ChannelType.EXTERNAL, ChannelType.TV].indexOf(deviceConfig.channels[i].type) === -1) {
        platform.log.warn(
          'Channel type not set, defaulting to "tv". You should change that if this channel is an HDMI device',
        );
        deviceConfig.channels[i].type = ChannelType.TV;
      }
    }

    const uuid = platform.api.hap.uuid.generate(deviceConfig.mac + deviceConfig.host);
    this.accessory = new platform.api.platformAccessory(
      deviceConfig.name,
      uuid,
      platform.api.hap.Categories.TELEVISION,
    );

    this.service =
      this.accessory.getService(this.platform.Service.Television) ||
      this.accessory.addService(this.platform.Service.Television);

    this.netcastClient = new NetcastClient(this.deviceConfig.host);

    this.unknownChannelIdentifier = this.deviceConfig.channels.length;
    this.unknownChannelName = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    this.offTimeout = null;
    this.offPause = false;
    this.currentChannel = null;
    this.channelUpdateInProgress = false;

    this.initTvService();
    this.initTvAccessory();
    this.initRemoteControlService();
    this.initSpeakerService();
    this.initInputSources();

    // interval for updating the current active identifier
    this.updateCurrentChannel();
    setInterval(() => {
      this.updateCurrentChannel();
    }, 5000);

    platform.api.publishExternalAccessories(PLUGIN_NAME, [this.accessory]);
  }

  initTvAccessory() {
    this.accessory
      .getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'LG')
      .setCharacteristic(this.platform.Characteristic.Model, this.deviceConfig.model || 'Netcast TV')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.deviceConfig.mac);
  }

  initTvService() {
    this.service
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(this.platform.Characteristic.ActiveIdentifier, 1)
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, this.deviceConfig.name)
      .setCharacteristic(this.platform.Characteristic.Name, this.deviceConfig.name)
      .setCharacteristic(
        this.platform.Characteristic.SleepDiscoveryMode,
        this.platform.Characteristic.SleepDiscoveryMode.ALWAYS_DISCOVERABLE,
      );

    this.service
      .getCharacteristic(this.platform.Characteristic.Active)
      .onSet(async (value: CharacteristicValue) => {
        if (value) {
          this.platform.log.debug('TV state changed to on, however turning on is not supported via Netcast API.');
          this.platform.log.debug('Use automations to turn the TV on, such as pinging an AppleTV.');

          if (this.offTimeout !== null) {
            clearTimeout(this.offTimeout);
            this.offPause = false;
          }
          return;
        }

        try {
          await this.sendAuthorizedCommand(LG_COMMAND.POWER);
        } catch (e) {
          this.platform.log.error('Failed to send power off command:', (e as Error).message);
          throw new this.platform.api.hap.HapStatusError(
            this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
          );
        }

        this.platform.log.debug(
          `TV turned off. Waiting ${this.deviceConfig.offPauseDuration}ms before polling status again.`,
        );
        this.offPause = true;
        this.offTimeout = setTimeout(() => {
          this.offPause = false;
          this.platform.log.debug('Off pause timeout cleared. Polling resumed.');
        }, this.deviceConfig.offPauseDuration);
      })
      .onGet(() => {
        this.platform.log.debug('Querying TV state...');
        return this.currentChannel !== null;
      });
  }

  initRemoteControlService() {
    this.service.getCharacteristic(this.platform.Characteristic.RemoteKey).onSet(async (newValue: CharacteristicValue) => {
      const commandMap: Record<number, LG_COMMAND> = {
        [this.platform.Characteristic.RemoteKey.REWIND]: LG_COMMAND.REWIND,
        [this.platform.Characteristic.RemoteKey.FAST_FORWARD]: LG_COMMAND.FAST_FORWARD,
        [this.platform.Characteristic.RemoteKey.NEXT_TRACK]: LG_COMMAND.SKIP_FORWARD,
        [this.platform.Characteristic.RemoteKey.PREVIOUS_TRACK]: LG_COMMAND.SKIP_BACKWARD,
        [this.platform.Characteristic.RemoteKey.ARROW_UP]: LG_COMMAND.UP,
        [this.platform.Characteristic.RemoteKey.ARROW_DOWN]: LG_COMMAND.DOWN,
        [this.platform.Characteristic.RemoteKey.ARROW_LEFT]: LG_COMMAND.LEFT,
        [this.platform.Characteristic.RemoteKey.ARROW_RIGHT]: LG_COMMAND.RIGHT,
        [this.platform.Characteristic.RemoteKey.SELECT]: LG_COMMAND.OK,
        [this.platform.Characteristic.RemoteKey.BACK]: LG_COMMAND.BACK,
        [this.platform.Characteristic.RemoteKey.EXIT]: LG_COMMAND.EXIT,
        [this.platform.Characteristic.RemoteKey.PLAY_PAUSE]: LG_COMMAND.PLAY,
        [this.platform.Characteristic.RemoteKey.INFORMATION]: LG_COMMAND.PROGRAM_INFORMATION,
      };

      const cmd = commandMap[newValue as number];
      if (cmd !== undefined) {
        try {
          await this.sendAuthorizedCommand(cmd);
        } catch (e) {
          this.platform.log.error('Failed to send remote command:', (e as Error).message);
        }
      }
    });
  }

  initSpeakerService() {
    const speakerService =
      this.accessory.getService(this.platform.Service.TelevisionSpeaker) ||
      this.accessory.addService(this.platform.Service.TelevisionSpeaker);

    speakerService
      .setCharacteristic(this.platform.Characteristic.Active, this.platform.Characteristic.Active.ACTIVE)
      .setCharacteristic(
        this.platform.Characteristic.VolumeControlType,
        this.platform.Characteristic.VolumeControlType.RELATIVE,
      );

    speakerService
      .getCharacteristic(this.platform.Characteristic.VolumeSelector)
      .onSet(async (newValue: CharacteristicValue) => {
        try {
          if (newValue === 0) {
            await this.sendAuthorizedCommand(LG_COMMAND.VOLUME_UP);
          } else {
            await this.sendAuthorizedCommand(LG_COMMAND.VOLUME_DOWN);
          }
        } catch (e) {
          this.platform.log.error('Failed to send volume command:', (e as Error).message);
        }
      });
  }

  initInputSources() {
    this.service
      .getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
      .onSet(async (newValue: CharacteristicValue) => {
        this.platform.log.info('set Active Identifier => setNewValue: ' + newValue);

        if (newValue === this.unknownChannelIdentifier) {
          return;
        }

        const newChannel = this.deviceConfig.channels[newValue as number];
        const currentChannel = this.currentChannel;

        this.channelUpdateInProgress = true;
        try {
          if (newChannel.channel.inputSourceIdx !== undefined) {
            if (newChannel.channel.inputSourceIdx !== currentChannel?.inputSourceIdx) {
              await this.switchToSourceIdx(parseInt(newChannel.channel.inputSourceIdx));
              await this.wait(3000);
            }
          }

          if (newChannel.type === ChannelType.TV) {
            const sessionId = await this.netcastClient.get_session(this.deviceConfig.accessToken);
            await this.netcastClient.change_channel(newChannel.channel, sessionId);
          }
        } catch (e) {
          this.platform.log.error('Failed to switch input:', (e as Error).message);
        } finally {
          this.channelUpdateInProgress = false;
        }
      });

    // Init all configured user channels
    for (const [i, chan] of this.deviceConfig.channels.entries()) {
      let existingChanService = this.findInputService(chan.name);
      if (existingChanService === null) {
        this.platform.log.info('Creating new input service: ', chan.name);
        existingChanService = this.accessory.addService(this.platform.Service.InputSource, chan.name, chan.name);
      }

      existingChanService
        .setCharacteristic(this.platform.Characteristic.ConfiguredName, chan.name)
        .setCharacteristic(this.platform.Characteristic.Identifier, i)
        .setCharacteristic(
          this.platform.Characteristic.InputSourceType,
          this.platform.Characteristic.InputSourceType.HDMI,
        )
        .setCharacteristic(
          this.platform.Characteristic.IsConfigured,
          this.platform.Characteristic.IsConfigured.CONFIGURED,
        );

      this.service.addLinkedService(existingChanService);
    }

    // Remove input sources that are no longer configured
    const channelNameMap: Record<string, null> = {};
    for (const c of this.deviceConfig.channels) {
      channelNameMap[c.name] = null;
    }

    for (const ser of this.accessory.services) {
      for (const linkedSer of ser.linkedServices) {
        if (channelNameMap[linkedSer.displayName] === undefined) {
          this.platform.log.info('Removed unused input service: ', linkedSer.displayName);
          this.service.removeLinkedService(linkedSer);
          this.accessory.removeService(linkedSer);
        }
      }
    }
  }

  wait(ms: number) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  async sendAuthorizedCommand(cmd: LG_COMMAND) {
    this.platform.log.debug('Sending command to TV: ', cmd, LG_COMMAND[cmd]);
    const sessionId = await this.netcastClient.get_session(this.deviceConfig.accessToken);
    return this.netcastClient.send_command(cmd, sessionId);
  }

  async switchToSourceIdx(idx: number) {
    const currentIdxStr = this.currentChannel?.inputSourceIdx;
    if (currentIdxStr === undefined) {
      return;
    }

    const currentIdx = parseInt(currentIdxStr);
    if (currentIdx === idx) {
      return;
    }

    this.platform.log.debug('Request to switch to input source idx: ', idx);
    this.platform.log.debug('Current source idx: ', currentIdx);

    this.platform.log.debug('Opening InputSource selection');
    await this.sendAuthorizedCommand(LG_COMMAND.EXTERNAL_INPUT);
    await this.wait(2000);

    if (currentIdx > idx) {
      const diff = currentIdx - idx - 1;
      for (let i = 1; i <= diff; i++) {
        await this.sendAuthorizedCommand(LG_COMMAND.LEFT);
        await this.wait(this.deviceConfig.keyInputDelay);
      }
      await this.sendAuthorizedCommand(LG_COMMAND.OK);
    }

    if (currentIdx < idx) {
      const diff = idx - currentIdx - 1;
      for (let i = 1; i <= diff; i++) {
        await this.sendAuthorizedCommand(LG_COMMAND.RIGHT);
        await this.wait(this.deviceConfig.keyInputDelay);
      }
      await this.sendAuthorizedCommand(LG_COMMAND.OK);
    }
  }

  async updateCurrentChannel() {
    if (this.offPause) {
      return;
    }

    try {
      const sessionId = await this.netcastClient.get_session(this.deviceConfig.accessToken);
      this.currentChannel = await this.netcastClient.get_current_channel(sessionId);
    } catch (e) {
      this.currentChannel = null;
    }

    if (this.currentChannel === null) {
      return;
    }

    if (this.channelUpdateInProgress) {
      return;
    }

    for (const [i, chan] of this.deviceConfig.channels.entries()) {
      if (
        (chan.type === ChannelType.EXTERNAL && chan.channel.inputSourceIdx === this.currentChannel.inputSourceIdx) ||
        (chan.type === ChannelType.TV &&
          chan.channel.major === this.currentChannel.major &&
          chan.channel.minor === this.currentChannel.minor)
      ) {
        const currentActiveIdentifier = this.service.getCharacteristic(this.platform.Characteristic.ActiveIdentifier)
          .value;

        this.platform.log.debug(`Potentially identified active channel as '${chan.name}'`);
        if (currentActiveIdentifier !== i) {
          this.service.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, i);
        }
        this.hideWildcardChannel();
        return;
      }
    }

    let chanName = this.currentChannel.chname || '';
    if (typeof chanName === 'object') {
      chanName = this.currentChannel.labelName || '';
    }
    if (typeof chanName === 'object') {
      chanName = this.currentChannel.inputSourceName || '';
    }

    this.updateWildcardChannel(chanName);
  }

  updateWildcardChannel(name: string) {
    this.platform.log.debug(`Creating temporary channel with name '${name}'`);
    let existingChanService = this.findInputService(this.unknownChannelName);
    if (existingChanService === null) {
      existingChanService = this.accessory.addService(
        this.platform.Service.InputSource,
        this.unknownChannelName,
        this.unknownChannelName,
      );
    }
    existingChanService
      .setCharacteristic(this.platform.Characteristic.ConfiguredName, name)
      .setCharacteristic(this.platform.Characteristic.Identifier, this.unknownChannelIdentifier)
      .setCharacteristic(
        this.platform.Characteristic.InputSourceType,
        this.platform.Characteristic.InputSourceType.OTHER,
      )
      .setCharacteristic(
        this.platform.Characteristic.IsConfigured,
        this.platform.Characteristic.IsConfigured.CONFIGURED,
      )
      .setCharacteristic(
        this.platform.Characteristic.CurrentVisibilityState,
        this.platform.Characteristic.CurrentVisibilityState.SHOWN,
      );
    this.service.addLinkedService(existingChanService);

    const currentActiveIdentifier = this.service.getCharacteristic(this.platform.Characteristic.ActiveIdentifier).value;
    if (currentActiveIdentifier !== this.unknownChannelIdentifier) {
      this.service.setCharacteristic(this.platform.Characteristic.ActiveIdentifier, this.unknownChannelIdentifier);
    }
  }

  hideWildcardChannel() {
    const existingChanService = this.findInputService(this.unknownChannelName);
    if (existingChanService === null) {
      return;
    }

    if (
      existingChanService.getCharacteristic(this.platform.Characteristic.CurrentVisibilityState).value ===
      this.platform.Characteristic.CurrentVisibilityState.HIDDEN
    ) {
      return;
    }

    this.platform.log.debug('Hiding temporary channel');
    existingChanService.setCharacteristic(
      this.platform.Characteristic.CurrentVisibilityState,
      this.platform.Characteristic.CurrentVisibilityState.HIDDEN,
    );
  }

  findInputService(name: string) {
    for (const ser of this.accessory.services) {
      for (const linkedSer of ser.linkedServices) {
        if (linkedSer.displayName === name) {
          this.platform.log.debug('Found existing input service: ', linkedSer.displayName);
          return linkedSer;
        }
      }
    }

    return null;
  }
}
