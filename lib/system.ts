import bind from 'bind-decorator';

import Device from './model/device';
import logger from './util/logger';
import * as settings from './util/settings';
import utils from './util/utils';

export default class System {
    private eventBus: EventBus;
    private zigbee: Zigbee;
    private systemFeedback: SystemFeedbackType;

    private properties: string[] = settings.get()['gateway']['ignoredPerperties'];

    constructor(eventBus: EventBus, zigbee: Zigbee) {
        this.eventBus = eventBus;
        this.zigbee = zigbee;
    }

    async start(): Promise<void> {
        logger.info("System started!");
        await this.sync_system_feedback_dev();
        this.eventBus.onUTSystemData(this, this.onSystemData);

        this.eventBus.onDeviceJoined(this, async (data: { device: Device; }) => {
            const ieeeAddr = data.device.ieeeAddr;
            await this.resetData(ieeeAddr);
        });
        this.eventBus.onDeviceLeave(this, (data: { ieeeAddr: string, name: string; }) => {
            const ieeeAddr = data.ieeeAddr;
            delete this.systemFeedback[ieeeAddr];
        });
    }

    async stop(): Promise<void> {
        logger.info("System stopped!");
        this.eventBus.removeListeners(this);
    }

    @bind async onSystemData(data: SystemFeedback): Promise<void> {
        const args: SystemFeedback = {};
        for (const property of this.properties) {
            if (property === 'source')
                args[property] = 'system';
            else
                args[property] = data[property];
        }
        this.systemFeedback[data.ieeeAddr] = args;
    }

    private getTimeout(device: Device): number {
        if (typeof device.options.availability === 'object' && device.options.availability?.timeout != null) {
            return utils.minutes(device.options.availability.timeout);
        }

        const key = this.isActiveDevice(device) ? 'active' : 'passive';
        let value = settings.get().availability?.[key]?.timeout;
        if (value == null) value = key == 'active' ? 10 : 1500;
        return utils.minutes(value);
    }

    private isActiveDevice(device: Device): boolean {
        return (device.zh.type === 'Router' && device.zh.powerSource !== 'Battery') ||
            device.zh.powerSource === 'Mains (single phase)';
    }

    public isAvailable(entity: Device): boolean {
        const ago = Date.now() - entity.zh.lastSeen;
        return ago < this.getTimeout(entity);
    }

    private getDefaultFeedback(ieeeAddr: string): SystemFeedback {
        const args: SystemFeedback = {};
        for (const property of this.properties) {
            if (property === 'ieeeAddr')
                args[property] = ieeeAddr;
            else if (property === 'source')
                args[property] = 'manual';
            else if (property.endsWith('Id'))
                args[property] = '0';
            else args[property] = '';
        }
        return args;
    }

    private async sync_system_feedback_dev(): Promise<void> {
        this.systemFeedback = {};
        const devices = this.zigbee.devices(false);
        for (const device of devices) {
            const entity = new Device(device.zh);
            await this.resetData(entity.ieeeAddr);
        }
    }

    public verifyData(ieeeAddr: string): SystemFeedback {
        let verifiedData: SystemFeedback = this.getDefaultFeedback(ieeeAddr);
        if (this.systemFeedback[ieeeAddr] != null) {
            verifiedData = {};
            this.properties.forEach(property => {
                verifiedData[property] = (
                    this.systemFeedback[ieeeAddr][property] !== undefined &&
                    this.systemFeedback[ieeeAddr][property] !== null) ? this.systemFeedback[ieeeAddr][property] : (property.endsWith('Id') ? '0' : '');
            });
            // this.systemFeedback[ieeeAddr] = this.getDefaultFeedback(ieeeAddr);
        }
        return verifiedData;
    }

    public async resetData(ieeeAddr: string): Promise<void> {
        this.systemFeedback[ieeeAddr] = this.getDefaultFeedback(ieeeAddr);
    }

    public getConfig(): { callbacks: string[], ignoredPerperties: string[], devices: object, alarmSetting: object; } {
        return {
            'callbacks': settings.get()['gateway']['callbacks'],
            'ignoredPerperties': settings.get()['gateway']['ignoredPerperties'],
            'devices': settings.get()['devices'],
            'alarmSetting': settings.get()['gateway']['alarmSetting']
        };
    }

    public setConfig(auth_token: string, callbacks: string[], ignoredPerperties: string[], devices: object, alarmSetting: object): void {
        try {
            if (auth_token) settings.set(['frontend', 'auth_token'], auth_token);
            if (callbacks && callbacks.length) settings.set(['gateway', 'callbacks'], callbacks);
            if (ignoredPerperties && ignoredPerperties.length) {
                const modifiedIgnoredPerperties = ignoredPerperties.filter((item: string) => !["ieeeAddr", "source", "callback_url"].includes(item));
                settings.set(['ignoredPerperties'], ["ieeeAddr", "source", "callback_url", ...modifiedIgnoredPerperties]);
            }
            if (devices && Object.keys(devices).length) settings.set(['devices'], devices);
            if (alarmSetting && Object.keys(alarmSetting).length) settings.set(['alarmSetting'], alarmSetting);
        }
        catch (e) {
            logger.warning(e);
        }
    }
}