/*jslint nomen: true, browser:true*/
/*global define */

define(['./config', 'jquery', 'jstools/tools', 'cookies'], function (config, $, tools, cookies) {
    "use strict";

    function XpConnect() {
        this.serverAddress = config.SERVER_ADDRESS;
        this.targetXp = config.TARGET_EXPERIMENT;
        this._factorsPromise = null;
        this._runPromise = null;
        this._postPromise = null;
        this._currentTrialPromise = null;
        this._lockPromise = null;
        this._lastPostRequest = null;
        this._unlockPromise = null;
        this._connectPromise = null;
        this._connected = false;
        var that = this;
        this._beforeunload = function(async){
            that.disconnectRun(async);
        };
    }

    XpConnect.prototype = {

        connectRun: function () {
            this._connected = true;
            if (this._connectPromise) {
                throw "Already connected.";
            }
            // preload some parameters
            this._connectPromise = this._requestRunLock().then(function () {
                return $.Deferred().resolve().promise();
            });
            this._updateFactors();
            this._updateCurrentTrial();

            $(window).on('beforeunload', this._beforeunload);
            return this._connectPromise;
        },

        disconnectRun: function () {
            $(window).off('beforeunload', this._beforeunload);
            var prom = this._unlock(false).then(function () {
                return $.Deferred().resolve().promise();
            });
            this._factorsPromise = null;
            this._runPromise = null;
            this._postPromise = null;
            this._currentTrialPromise = null;
            this._lockPromise = null;
            this._lastPostRequest = null;
            this._unlockPromise = null;
            this._connectPromise = null;
            this._connected = false;
            return prom;
        },

        get connected() {
            return this._connected;
        },

        _updateFactors: function () {
            var address = this.serverAddress + '/experiment/' + this.targetXp + '/factors';
            this._factorsPromise = $.get(address);
            return this.factors;
        },

        get factors() {
            return this._factorsPromise || this._updateFactors();
        },

        updateRun: function () {
            if (!this.connected) throw "Not connected.";
            // get the possible value of the cookie (unfinished run)
            var runId = cookies.get('running-run-id'),

                // if we could get a run id request the corresponding run
                // else just request a free run
                address = runId ?
                    this.serverAddress + '/run/' + this.targetXp + '/' + runId :
                    this.serverAddress + '/experiment/' + this.targetXp + '/next_run';


            this._runPromise = $.get(address);

            this._runPromise.done(function (run) {
                // check if the updated run has been recorded as run id
                // in that case, if it is complete remove it
                var registeredRunId = cookies.get('running-run-id');
                if (run.completed && run.id == registeredRunId) {
                    cookies.expire('running-run-id');
                }
            });
            return this.run;
        },

        get run() {
            return this.connected ? (this._runPromise || this.updateRun()) : null;
        },

        _requestRunLock: function () {
            if (this._lockPromise) {
                throw "Lock already requested.";
            }
            var that = this,
                run = null;
            // wait for the run request and the unlock promise (if any)
            this._lockPromise = $.when(this.run, this._unlockPromise).then(function (runPromise) {
                run = runPromise[0];
                var address = that.serverAddress + '/run/' + that.targetXp + '/' + run.id + '/lock';
                // request the lock token
                return $.get(address);
            });
            return this._lockPromise;
        },

        get _lock() {
            return this._lockPromise || null;
        },

        _unlock: function (async) {
            if (!this.connected) {
                throw "Not connected.";
            }
            var that = this;
            if (!this._lockPromise) {
                return this.updateRun();
            }
            this._unlockPromise = this._lock.then(function (lock) {
                var postParams = {
                    type: "POST",
                    url: '' + that.serverAddress + '/run/' + that.targetXp + '/' + lock.run_id + '/unlock',
                    data: {
                        token: lock.token
                    },
                    async: async
                };
                return $.ajax(postParams);
            });
            this._lockPromise = null;
            return this._unlockPromise;
        },

        _updateCurrentTrial: function () {
            if (!this.connected) {
                throw "Not connected.";
            }
            var that = this;
            // we need the run information, but also need to be sure the last post request has been finished
            this._currentTrialPromise = $.when(this.run, this._lastPostRequest).then(function (resultsRun) {
                // build the address
                var run = resultsRun[0],
                    address = that.serverAddress + '/run/' + run.experiment_id + '/' + run.id + '/current_trial';
                // get the current trial
                return $.get(address);
            }).then(null, function (error) {
                // an error will occur if the run is completed
                // in that case we update the run
                return that.updateRun().then(function (run) {
                    // check if it is really completed
                    if (run.completed) {
                        // if it is the result is null
                        return $.Deferred().resolve(null).promise();
                    } else {
                        // otherwise the error comes from something else, reject.
                        return $.Deferred().reject(error).promise();
                    }
                });
            });
            return this.currentTrial;
        },

        get currentTrial() {
            return this.connected ? (this._currentTrialPromise || this._updateCurrentTrial()) : null;
        },

        sendTrialResults: function (data) {
            if (!this.connected) {
                throw "Not connected.";
            }
            var that = this,
                // run is cached so we can reference it once it is registered (done part)
                run = null,

                // we need the run information, we make sure the run is locked
                // we also need current trial
                when = $.when(this.run, this._lock, this.currentTrial),
                then = when.then(function (runPromise, lockPromise, currentTrialPromise) {
                    var currentTrial = currentTrialPromise[0],
                        token = lockPromise[0].token,

                        // build the address pass
                        path = [currentTrial.experiment_id,
                            currentTrial.run_id,
                            currentTrial.block_number,
                            currentTrial.number].join('/'),
                        address = that.serverAddress + '/trial/' + path;

                    // add the token into the data
                    data.token = token;

                    // register the run
                    run = runPromise[0];

                    // post the data
                    return $.post(address, data);
                }).done(function () {
                    // cookie is set if we can lock the run
                    cookies.set('running-run-id', run.id, {
                        secure: false,
                        expires: 60 * 60 * 24
                    });
                });

            // registers the last post request
            this._lastPostRequest = then;

            // force the current trial to be updated (will wait the end of the post request)
            this._updateCurrentTrial();
            return this._lastPostRequest;
        }
    };

    return XpConnect;

});