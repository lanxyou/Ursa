import * as fs from 'fs';
import * as path from 'path';
import * as compose from 'koa-compose';

import Ursa from '../core/Ursa';
import mixin from '../utils/mixin';
import typeHelper from '../utils/typeHelper';
import Require from '../utils/Require';

import { TPluginConfig } from '../types/TPluginConfig';
import { TPlugin } from '../types/TPlugin';
import { IContext } from '../types/IContext';
import { Results } from '../extends/Results';

export default class PluginLoader {
    static loadPluginConfig() {
        const pluginConfig = Ursa.config.plugin;

        if (!pluginConfig) return;

        for (const [name, config] of Object.entries(pluginConfig)) {
            if (config === true) {
                pluginConfig[name] = {
                    name,
                    enable: true,
                };
            }
        }

        return pluginConfig;
    }

    static complexPlugin(plugin: TPlugin, options: any) {
        const ursa = Ursa.instance();
        const mws = [];

        // 按照配置的顺序进行加载
        for (const [key, val] of Object.entries(plugin)) {
            if (key === 'request') {
                mixin(false, ursa.app.request, val);
            } else if (key === 'response') {
                mixin(false, ursa.app.response, val);
            } else if (key === 'context') {
                mixin(false, ursa.context, val);
            } else if (key === 'results') {
                mixin(false, Results, val);
            } else if (key === 'use') {
                const { handler } = val;

                mws.push((ctx: IContext, next: Function) => handler(ctx, next, options));
            } else if (key === 'filter') {
                const { regexp = /.*/, handler } = val;

                mws.push((ctx: IContext, next: Function) => (regexp.test(ctx.url) ? handler(ctx, next, options) : next()));
            } else if (key === 'ignore') {
                const { regexp = /.*/, handler } = val;

                mws.push((ctx: IContext, next: Function) => (!regexp.test(ctx.url) ? handler(ctx, next, options) : next()));
            } else if (key === 'method') {
                const { type, handler } = val;

                mws.push((ctx: IContext, next: Function) => (type.indexOf(ctx.method) > -1 ? handler(ctx, next, options) : next()));
            }
        }

        if (mws.length > 0) ursa.use(compose(mws));
    }

    static async loadPLugin(pluginConfig: TPluginConfig) {
        const plugin: TPlugin | Function = Require.default(pluginConfig.path);
        const ursa = Ursa.instance();
        const options = mixin(true, {}, pluginConfig.options || {}, Ursa.config[pluginConfig.name] || {});

        // plugin.options & {plugin}.config
        pluginConfig.options = options;

        if (typeHelper.isFunction(plugin)) {
            const pluginResult = await Promise.resolve(plugin(ursa, options));

            if (typeHelper.isFunction(pluginResult)) ursa.use(pluginResult);
            else if (typeHelper.isObject(pluginResult)) PluginLoader.complexPlugin(pluginResult, options);
        } else if (typeHelper.isObject(plugin)) {
            PluginLoader.complexPlugin(plugin, options);
        }
    }

    static async loadDir(rootPath: string) {
        const pluginConfig = PluginLoader.loadPluginConfig();

        if (!pluginConfig) return;

        // 尝试在以下目录找到匹配的插件
        //  -> {ROOT}/plugins
        //      -> {ROOT}/node_modules
        const dirs = [
            path.resolve(rootPath, './plugins'),
            path.resolve(rootPath, '../node_modules'),
        ];

        for (const [name, config] of Object.entries(pluginConfig)) {
            if (typeHelper.isBoolean(config)) continue;

            const packageName = config.packageName || `@ursajs/plugin-${name}`;
            let isDirExist = false;

            for (const dir of dirs) {
                const target = path.join(dir, dir.indexOf('node_modules') > -1 ? packageName : name);

                if (fs.existsSync(target)) {
                    config.path = target;
                    await PluginLoader.loadPLugin(config);

                    isDirExist = true;
                }
            }

            if (!isDirExist) {
                throw new Error(`plugin ${name} not found`);
            }
        }
    }
}
