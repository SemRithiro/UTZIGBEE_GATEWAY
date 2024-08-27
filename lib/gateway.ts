import axios from 'axios';
import bind from 'bind-decorator';
import { exec } from 'child_process';
import cors from 'cors';
import express, { Express, Request, Response, json } from 'express';
import stringify from 'json-stable-stringify-without-jsonify';

import Device from './model/device';
import System from './system';
import logger from './util/logger';
import * as settings from './util/settings';

export default class Gateway {
    private zigbee: Zigbee;
    private eventBus: EventBus;
    private system: System;

    private gateway: Express = express();
    private port: number = settings.get()['gateway']['port'];
    private cors: string = settings.get()['gateway']['cors'];
    private callbacks: string[] = settings.get()['gateway']['callbacks'];

    private properties: string[] = settings.get()['gateway']['ignoredPerperties'];

    constructor(eventBus: EventBus, zigbee: Zigbee, system: System) {
        this.eventBus = eventBus;
        this.zigbee = zigbee;
        this.system = system;
    }

    async start(): Promise<void> {
        logger.info('Gateway started!');
        this.gateway.use(json());
        this.gateway.use(cors({ origin: this.cors }));
        this.gateway.listen(this.port, (): void => {
            logger.info(`Gateway is running on port ${this.port}`);
            this.loadApi();
        });

        this.eventBus.onUTDeviceState(this, this.onUTDeviceState);

    }

    async stop(): Promise<void> {
        logger.info('Gateway stopped!');
    }

    @bind async onUTDeviceState(data: { topic: string, callback_url: string, payload: { [key: string]: any; }; }): Promise<void> {
        const body: { [key: string]: string | object; } = {
            topic: `utzigbee/${data.topic}`,
            type: data.payload.type,
            payload: { ...data.payload },
            ...data.payload.system
        };
        const info: { [key: string]: any; } = {
            callback: data.callback_url,
            topic: body.topic,
            type: data.payload.type,
            controlSource: (body.payload as any).controlSource,
            userData: { ...data.payload.system }
        };

        delete data.payload.system;
        if (settings.get()['gateway'] && settings.get()['gateway']['default_devices'].includes(data.payload.device.model))
            logger.info(stringify(info));

        if (settings.get()['gateway'] && settings.get()['gateway']['alarmSetting']['models'].includes(data.payload.device.model)) return;

        if (data.callback_url !== '') {
            axios.post(`${data.callback_url}/point_of_sales/deviceCallBackFn`, body).then(() => {
                // console.log(res);
            }).catch(() => {
                // console.error(err);
            });
        } else {
            this.callbacks.forEach(url => {
                axios.post(`${url}/point_of_sales/deviceCallBackFn`, body).then(() => {
                    // console.log(res);
                }).catch(() => {
                    // console.error(err);
                });
            });
        }
    }

    private getZigbeeDevices(name: string = ''): DeviceType[] {
        const devices = this.zigbee.devices(false);
        const devicesList: DeviceType[] = [];
        devices.filter(device => {
            if (device.isDevice()) {
                const entity = new Device(device.zh);
                if (name === '') return true;
                else if (entity.name === name) return true;
            }
            return false;
        }).map(device => {
            try {
                const entity = new Device(device.zh);
                const deviceInfo: DeviceType = {
                    name: entity.name,
                    ieeeAddr: entity.ieeeAddr,
                    friendly_name: entity.options.friendly_name,
                    vendor: device.definition ? device.definition.vendor : 'Unknown',
                    model: device.definition ? device.definition.model : 'Unknown',
                    availability: this.system.isAvailable(device) ? 'online' : 'offline'
                };
                if (settings.get()['gateway']['default_devices'].includes(deviceInfo.model)) {
                    deviceInfo.state = device.endpoint(1).getClusterAttributeValue('genOnOff', 'onOff') ? 'ON' : 'OFF';
                    deviceInfo.energy = device.endpoint(1).getClusterAttributeValue('seMetering', 'currentSummDelivered') ? parseInt(device.endpoint(1).getClusterAttributeValue('seMetering', 'currentSummDelivered').toString().split(',')[1]) / 100 : -1;
                }
                devicesList.push(deviceInfo);
            } catch (e) {
                logger.warning(e);
            }

        });
        // for (var device of devices) {
        //     try {
        //         if (name === '') {
        //             if (device.isDevice()) {
        //                 var entity = new Device(device.zh);
        //                 var deviceInfo: DeviceType = {
        //                     name: entity.name,
        //                     ieeeAddr: entity.ieeeAddr,
        //                     friendly_name: entity.options.friendly_name,
        //                     vendor: device.definition ? device.definition.vendor : 'Unknown',
        //                     model: device.definition ? device.definition.model : 'Unknown',
        //                     availability: this.system.isAvailable(device) ? 'online' : 'offline'
        //                 };
        //                 if (['TO-Q-SY1-JZT'].includes(deviceInfo.model)) {
        //                     deviceInfo.state = device.endpoint(1).getClusterAttributeValue('genOnOff', 'onOff') ? 'ON' : 'OFF';
        //                     deviceInfo.energy = device.endpoint(1).getClusterAttributeValue('seMetering', 'currentSummDelivered') ? parseInt(device.endpoint(1).getClusterAttributeValue('seMetering', 'currentSummDelivered').toString().split(',')[1]) / 100 : -1;
        //                 }
        //                 devicesList.push(deviceInfo);
        //             }
        //         } else {
        //             if (entity.name === name) {
        //                 if (device.isDevice()) {
        //                     var entity = new Device(device.zh);
        //                     var deviceInfo: DeviceType = {
        //                         name: entity.name,
        //                         ieeeAddr: entity.ieeeAddr,
        //                         friendly_name: entity.options.friendly_name,
        //                         vendor: device.definition ? device.definition.vendor : 'Unknown',
        //                         model: device.definition ? device.definition.model : 'Unknown',
        //                         availability: this.system.isAvailable(device) ? 'online' : 'offline'
        //                     };
        //                     if (['TO-Q-SY1-JZT'].includes(deviceInfo.model)) {
        //                         deviceInfo.state = device.endpoint(1).getClusterAttributeValue('genOnOff', 'onOff') ? 'ON' : 'OFF';
        //                         deviceInfo.energy = device.endpoint(1).getClusterAttributeValue('seMetering', 'currentSummDelivered') ? parseInt(device.endpoint(1).getClusterAttributeValue('seMetering', 'currentSummDelivered').toString().split(',')[1]) / 100 : -1;
        //                     }
        //                     devicesList.push(deviceInfo);
        //                 }
        //             }
        //         }
        //     } catch (e) {
        //         logger.warn(e);
        //     }
        // }
        return devicesList;
    }

    async pm2RestartExec(key: string): Promise<void> {
        const { stdout, stderr } = exec(`pm2 restart ${key}`);
        logger.info(`[pm2 COMMAND: ${stdout}`);
        logger.info(`[pm2 COMMAND: ${stderr}`);
    }

    private loadApi(): void {
        this.gateway.get('/utzigbee/devices', (req: Request, res: Response) => {
            const { name = '' } = req.query;
            return res.json(this.getZigbeeDevices(name.toString()));
        });

        this.gateway.get('/utzigbee/devicesObj', (req: Request, res: Response) => {
            const { name = '' } = req.query;
            const response: { [key: string]: string | number | null; } = {};
            const devices = this.getZigbeeDevices(name.toString());
            devices.forEach(device => {
                response[device.name] = device.energy;
            });

            return res.json(response);
        });

        this.gateway.get('/utzigbee/mute_all_sirens', (req: Request, res: Response) => {
            this.getZigbeeDevices().forEach(device => {
                if (settings.get()['gateway']['alarmSetting']['models'].includes(device.model))
                    this.eventBus.emitMQTTMessage({
                        topic: `utzigbee/${device.name}/set`, message: stringify({
                            'alarm': 'OFF'
                        })
                    });
            });
            return res.send('OK');
        });

        this.gateway.get('/utzigbee/get_config', (req: Request, res: Response) => {
            return res.json(this.system.getConfig());
        });

        this.gateway.post('/utzigbee/set_config', (req: Request, res: Response) => {
            const { password, callbacks, auth_token, ignoredPerperties, devices, alarmSetting } = req.body;
            if (password === settings.get()['frontend']['auth_token']) {
                this.system.setConfig(auth_token, callbacks, ignoredPerperties, devices, alarmSetting);
                return res.send('OK');
            } else {
                return res.send('Invalid credential!');
            }
        });

        this.gateway.post('/utzigbee/pm2_restart', (req: Request, res: Response) => {
            const { password, key } = req.body;
            if (password === settings.get()['frontend']['auth_token']) {
                setTimeout(this.pm2RestartExec, 1000, key);
                return res.send('Restart in 1 sec');
            } else {
                return res.send('Invalid credential!');
            }
        });

        this.gateway.post('/utzigbee/device', (req: Request, res: Response) => {
            const { topic, payload } = req.body;
            const args: { [key: string]: any; } = {};
            for (const property of this.properties) {
                if (req.body[property])
                    args[property] = req.body[property];
            }

            this.eventBus.emitMQTTMessage({ topic, message: stringify({ ...payload, ...args }) });

            return res.send('OK');
        });
    }
}