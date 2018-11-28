'use strict';

Object.defineProperty(exports, '__esModule', { value: true });

function _interopDefault (ex) { return (ex && (typeof ex === 'object') && 'default' in ex) ? ex['default'] : ex; }

var _ = _interopDefault(require('lodash'));
var core = require('@pollyjs/core');
var utils = require('@pollyjs/utils');
var ParentFSPersister = _interopDefault(require('@pollyjs/persister-fs'));

class FSPersister extends ParentFSPersister {
    static get name() {
        return 'fs';
    }

    saveRecording(recordingId, data) {
        /*
            Pass the data through the base persister's stringify method so
            the output will be consistent with the rest of the persisters.
        */
        const { log } = data;
        log.entries = _.sortBy(log.entries, ['request.url', 'request.postData.text', '_id']).map(
            v => ({
                ..._.omit(v, ['startedDateTime', 'time']),
                timings: _.omit(v.timings, ['wait']),
            }),
        );
        this.api.saveRecording(recordingId, JSON.parse(this.stringify(data)));
    }
}

const { flush, stop } = core.Polly.prototype;

function setupPolly(recordingName, mode = '') {
    const intercepted = {};
    const extraPromises = [];
    let lastCall;
    let pendingRequests = Number.MAX_SAFE_INTEGER;

    const polly = new core.Polly(
        _.camelCase(
            recordingName
                .replace(/^.+\/src\//, '')
                .replace(/^.+__tests__\//, '')
                .replace(/(?:\.test)?\.js$/, ''),
        ),
        { adapters: ['fetch'], persister: 'fs' },
    );
    polly.configure({ mode: mode || process.env.POLLY_MODE || utils.MODES.REPLAY });
    polly.server
        .any()
        .on('request', req => {
            lastCall = req.requestArguments;
            pendingRequests += 1;
        })
        .on('response', () => {
            if (pendingRequests > 0) {
                pendingRequests -= 1;
            }
        });
    polly.server.delete('*').intercept((__, res) => res.sendStatus(204));
    polly.server.put('*').intercept((__, res) => res.sendStatus(204));
    polly.server.post('*').intercept((req, res, interceptor) => {
        const { query } = JSON.parse(req.body);
        const queryName = query && Object.keys(intercepted).find(v => query.startsWith(v));
        if (queryName) {
            const [json, status = 200] = intercepted[queryName];
            res.status(status).json(json);
        } else if (query && query.startsWith('query ')) {
            interceptor.abort();
        } else {
            res.sendStatus(204);
        }
    });

    /**
     * Wait to all the requests and promises to resolve
     */
    Object.defineProperty(polly, 'flush', {
        value: async function() {
            const milliseconds = process.env.REACT_DEVTOOLS ? 1000 : 0;
            await new Promise(r => setTimeout(r, milliseconds));
            pendingRequests = Number.MAX_SAFE_INTEGER;
            while (pendingRequests > 0) {
                await Promise.all(extraPromises);
                pendingRequests = 0;
                await flush.call(this);
                await new Promise(r => setTimeout(r, milliseconds));
            }
        },
    });
    Object.defineProperty(polly, 'asyncFind', {
        value: async (app, enzymeSelector, times = 3) => {
            while (times >= 0) {
                times -= 1;
                await polly.flush();
                app.update();
                const wrapper = app.find(enzymeSelector);
                if (wrapper.exists()) return wrapper;
            }
            throw `Expected "${enzymeSelector}" to exist.`;
        },
    });
    Object.defineProperty(polly, 'addExtraPromise', { value: v => extraPromises.push(v) });
    Object.defineProperty(polly, 'lastCall', { get: () => lastCall });
    Object.defineProperty(polly, 'lastGraphQL', {
        get: () => {
            if (!Array.isArray(lastCall)) return lastCall;
            const [, { body = '{}' } = {}] = lastCall;
            return JSON.parse(body);
        },
    });
    Object.defineProperty(polly, 'interceptGraphQL', {
        value: (queryName, json, status = 200) => {
            intercepted[queryName] = [json, status];
        },
    });
    Object.defineProperty(polly, 'stop', {
        value: async function() {
            await polly.flush();
            return stop.call(this);
        },
    });

    return polly;
}

exports.FSPersister = FSPersister;
exports.setupPolly = setupPolly;
