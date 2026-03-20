import {
  API,
  DynamicPlatformPlugin,
  Logger,
  PlatformAccessory,
  PlatformConfig,
  Service,
  Characteristic,
} from 'homebridge';

import { LgNetcastTV } from './platformAccessory';
import { Channel } from 'lg-netcast';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export enum ChannelType {
  TV = 'tv',
  EXTERNAL = 'external',
}

export interface ChannelConfig {
  name: string;
  type: ChannelType;
  channel: Channel;
}

export interface DeviceConfig {
  name: string;
  host: string;
  model: string;
  mac: string;
  accessToken: string;
  channels: ChannelConfig[];
  keyInputDelay: number;
  offPauseDuration: number;
}

interface LgNetcastPlatformConfig extends PlatformConfig {
  devices?: DeviceConfig[];
}

export class LgNetcastPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly deviceConfig: DeviceConfig[];

  // this is used to track restored cached accessories
  public readonly devices: PlatformAccessory[] = [];

  constructor(public readonly log: Logger, public readonly config: LgNetcastPlatformConfig, public readonly api: API) {
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    if (!config.devices || config.devices.length === 0) {
      this.log.warn('No devices configured. Please add devices in the Homebridge config.');
      config.devices = [];
    }

    this.deviceConfig = config.devices;

    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.devices.push(accessory);
  }

  removeAccessory(accessory: PlatformAccessory) {
    this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
  }

  discoverDevices() {
    for (const device of this.deviceConfig) {
      new LgNetcastTV(this, device);
    }
  }
}
