import _ from 'lodash';
import { Polly } from '@pollyjs/core';
import { MODES } from '@pollyjs/utils';
import ParentFSPersister from '@pollyjs/persister-fs';

export class FSPersister extends ParentFSPersister {
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

const { flush, stop } = Polly.prototype;

export function setupPolly(recordingName, mode = '') {
    const intercepted = {};
    const extraPromises = [];
    let lastCall;
    let pendingRequests = 0;

    const polly = new Polly(
        _.camelCase(
            recordingName
                .replace(/^.+\/src\//, '')
                .replace(/^.+__tests__\//, '')
                .replace(/(?:\.test)?\.js$/, ''),
        ),
        { adapters: ['fetch'], persister: 'fs' },
    );
    polly.configure({ mode: mode || process.env.POLLY_MODE || MODES.REPLAY });
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
            await Promise.all(extraPromises);
            while (pendingRequests > 0) {
                // wait also for requests generated after the initial requests are resolved
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
                app.update();
                const wrapper = app.find(enzymeSelector);
                if (wrapper.exists()) return wrapper;
                await polly.flush();
            }
            throw new Error(`Expected "${enzymeSelector}" to exist.`);
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
