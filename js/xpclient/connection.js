/*jslint nomen: true, browser:true*/
/*global define */

define(['./config', 'jquery', 'jstools/tools', 'cookies'], function (config, $, tools, cookies) {
    "use strict";

    function XpConnect() {
        this.serverAddress = config.SERVER_ADDRESS;
        this.targetXp = config.TARGET_EXPERIMENT;
        this._lastRequestPromise = null;
        this._factorsPromise = null;
        this._runPromise = null;
        this._postPromise = null;
        this._currentTrialPromise = null;
        this._lastPostRequest = null;
        this._runId = null;
        this._init();

    }

    XpConnect.prototype = {

        _init: function () {
            // preload some parameters
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


        _requestNewRun: function () {
            var address = this.serverAddress + '/experiment/' + this.targetXp + '/next_run';
            return $.get(address);
        },

        _requestRun: function (runId) {
            var address = this.serverAddress + '/run/' + this.targetXp + '/' + runId;
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

        sendTrialResults: function (trialResults) {
            var that = this;
            this._lastPostRequest = this.currentTrial.then(function (currentTrial) {
                // build the address pass
                var path = [currentTrial.experiment_id, currentTrial.run_id, currentTrial.block_number, currentTrial.number].join('/'),
                    address = that.serverAddress + '/trial/' + path;
                return $.post(address, trialResults);
            });
            this._updateCurrentTrial();
            return this._lastPostRequest;
        }
    };

    return XpConnect;

});