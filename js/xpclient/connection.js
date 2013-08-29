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
        this._runId = null;
        this._init();
        this._lock = null;

        $(window).on('beforeunload', $.proxy(function(){
            this._unlock(false);
        }, this));
    }

    XpConnect.prototype = {

        _init: function () {
            // preload some parameters
            this._requestLock().fail(function (e) {
                alert("Couldn't lock the run: " + e.responseJSON.message);
            });
            this._updateFactors();
            this._updateCurrentTrial();
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
            var runId = this._runId || cookies.get('running-run-id');
            this._runPromise = runId ? this._requestRun(runId) : this._requestNewRun();
            this._updateRunReg();
            return this.run;
        },

        get run() {
            return this._runPromise || this.updateRun();
        },

        _requestLock: function () {
            if (this._lockPromise) {
                throw "Lock already requested.";
            }
            var that = this;
            this._lockPromise = $.when(this.run, this._unlockPromise).then(function (runPromise) {
                var run = runPromise[0];
                return that._requestLockToken(run.id);
            }).done(function(lock){
                this._lock = lock;
            });
            return this._lockPromise;
        },

        get lock() {
            return this._lockPromise || this._requestLock();
        },

        _unlock: function (async) {
            var that = this;
            if (!this._lockPromise) {
                return this.updateRun();
            } 
            this._unlockPromise = this.lock.then(function (lock) {
                var postParams = {
                        type: "POST",
                        url: ''+that.serverAddress + '/run/' + that.targetXp + '/' + lock.run_id + '/unlock',
                        data:{ token: lock.token },
                        async: async
                    };
                return $.ajax(postParams);
            });
            this._lockPromise = null;
            return this._unlockPromise;
        },


        _requestNewRun: function () {
            var address = this.serverAddress + '/experiment/' + this.targetXp + '/next_run';
            return $.get(address);
        },

        _requestRun: function (runId) {
            var address = this.serverAddress + '/run/' + this.targetXp + '/' + runId;
            return $.get(address);
        },

        _requestLockToken: function (runId) {
            var address = this.serverAddress + '/run/' + this.targetXp + '/' + runId + '/lock';
            return $.get(address);
        },


        _updateRunReg: function () {
            var that = this;
            this.run.done(function (run) {
                that._runId = run.id;
                if (run.completed) {
                    cookies.expire('running-run-id');
                } else {
                    cookies.set('running-run-id', run.id, {
                        secure: false,
                        expires: 60 * 60 * 24
                    });
                }
            });
        },

        _updateCurrentTrial: function () {
            var that = this;
            this._currentTrialPromise = $.when(this.run, this._lastPostRequest).then(function (resultsRun) {
                var run = resultsRun[0],
                    address = that.serverAddress + '/run/' + run.experiment_id + '/' + run.id + '/current_trial';
                return $.get(address);
            });
            return this.currentTrial;
        },

        get currentTrial() {
            return this._currentTrialPromise || this._updateCurrentTrial();
        },

        sendTrialResults: function (data) {
            var that = this;
            this._lastPostRequest = $.when(this.currentTrial, this.lock).then(function (currentTrialPromise, lockPromise) {
                var currentTrial = currentTrialPromise[0],
                    token = lockPromise[0].token,
                    // build the address pass
                    path = [currentTrial.experiment_id, currentTrial.run_id, currentTrial.block_number, currentTrial.number].join('/'),
                    address = that.serverAddress + '/trial/' + path;
                data.token = token;
                return $.post(address, data);
            });
            this._updateCurrentTrial();
            return this._lastPostRequest;
        }
    };

    return XpConnect;

});