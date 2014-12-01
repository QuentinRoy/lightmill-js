define(['./default-config', 'jquery', 'jstools/tools', 'cookies'], function (defaultConfig, $, tools, cookies) {
    "use strict";

    function XpConnect(config) {
        // merge the default config with the provided config
        config = $.extend({}, defaultConfig, config);

        this.serverAddress = config.serverAddress;
        this.targetXp = config.experiment || config.targetExperiment; // targetExperiment is deprecated
        this.targetXpFile = config.experimentFile;

        this._experimentPromise = null;
        this._runPromise = null;
        this._postPromise = null;
        // this._currentTrialPromise = null;
        this._lockPromise = null;
        this._currentPostRequest = null;
        this._unlockPromise = null;
        this._connectPromise = null;
        this._disconnectPromise = null;
        this._connected = false;

        this._currentTrialNum = null;

        // function to be automatically called at window unloading when run is connected
        var that = this;
        this._beforeunload = function () {
            that.disconnectRun(false);
        };
    }

    XpConnect.prototype = {

        initExperiment: function(){
            var that = this;

            // request for the experiment list
            var expeReq = $.ajax({
                url: this.serverAddress + '/experiments',
                dataType: 'json',
                type: 'GET',
                cache: false,
                // cross-domain disables the X-Request-With
                headers: {'X-Requested-With': 'XMLHttpRequest'}
            }).then(function(data){
                // filters the data for when
                return data;
            });

            return $.when(expeReq, that._getExperimentId()).then(function(experiments, resExpeId){
                // look for the experiment Id into the experiment list
                var targetExpe = experiments[resExpeId];
                // if it does not exists imports it
                if(!targetExpe){
                    return that._getExperimentFile().then(function(expeXML){
                        return $.ajax({
                            url: that.serverAddress +  '/import',
                            dataType: 'json',
                            contentType: 'application/xml',
                            type: 'POST',
                            headers: {'X-Requested-With': 'XMLHttpRequest'},
                            data: expeXML
                        });
                    })
                }
            }).then(function(){
                // filters everything
                return $.Deferred().resolve().promise();           
            });
        },

        _getExperimentId: function(){
            var that = this;
            if(that._experimentIdPromise) return that._experimentIdPromise;
            // request for the target experiment name
            if(that.targetXp) {
                // if the name is provided just return it
                that._experimentIdPromise = $.Deferred().resolve([that.targetXp]);
            } else {
                // else request the experiment file and extract it
                that._experimentIdPromise = that._getExperimentFile().then(function(xmlStr){
                    that.targetXp = $($.parseXML(xmlStr)).find("experiment").attr('id');
                    return that.targetXp;
                });
            }
            return that._experimentIdPromise;
        },

        _getExperimentFile: function() {
            this._experimentFilePromise = this._experimentFilePromise || $.ajax({
                    url: this.targetXpFile,
                    type: 'GET',
                    dataType: 'text' // get the xml in plain text
                });
            return this._experimentFilePromise;
        },

        connectRun: function (targetRun) {
            this._targetRun = targetRun;
            var that = this;
            this._connected = true;
            if (this._connectPromise) {
                throw "Already connected.";
            }
            // preload some parameters
            this._connectPromise = $.when(this._disconnectPromise).then(function () {
                return that._requestRunLock();
            }).then(function () {
                return $.Deferred().resolve().promise();
            });
            this._updateExperiment();
            this._updateTrials();
            // this._updateCurrentTrial();

            $(window).on('unload', this._beforeunload);
            return this._connectPromise;
        },

        disconnectRun: function (async) {
            $(window).off('beforeunload', this._beforeunload);
            this._disconnectPromise = this._unlock(async).then(function () {
                return $.Deferred().resolve().promise();
            });
            this._factorsPromise = null;
            this._runPromise = null;
            this._postPromise = null;
            this._lockPromise = null;
            this._currentPostRequest = null;
            this._unlockPromise = null;
            this._connectPromise = null;
            this._connected = false;
            this._trials = null;
            return this._disconnectPromise;
        },

        get connected() {
            return this._connected;
        },

        get experiment() {
            return this._experimentPromise || this._updateExperiment();
        },

        _updateExperiment: function () {
            var address = this.serverAddress + '/experiment/' + this.targetXp;
            this._experimentPromise = $.ajax({
                url: address,
                dataType: 'json',
                type: 'GET',
                cache: false
            }).then(function (xp) {
                // filters useless results
                return xp;
            });
            return this.experiment;
        },

        updateRun: function () {
            if (!this.connected) throw "Not connected.";
            // get the possible value of the cookie (unfinished run)
            var runId = this._targetRun || cookies.get('running-run-id'),

                // if we could get a run id request the corresponding run
                // else just request a free run
                address = runId ?
                    this.serverAddress + '/run/' + this.targetXp + '/' + runId :
                    this.serverAddress + '/experiment/' + this.targetXp + '/next_run';


            this._runPromise = $.ajax({
                url: address,
                dataType: 'json',
                type: 'GET',
                cache: false
            }).then(function (result) {
                // filters unused result arguments
                return result;
            });

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
            var that = this;
            // wait for the run request and the unlock promise (if any)
            this._lockPromise = $.when(this.run, this._unlockPromise).then(function (run) {
                var address = that.serverAddress + '/run/' + that.targetXp + '/' + run.id + '/lock';
                // request the lock token
                return $.ajax({
                    type: 'GET',
                    url: address,
                    // async lock can make async unlock call to be missed and so lock undefinetely the run
                    async: false,
                    cache: false
                }).then(function (result) {
                    // filters unused result arguments
                    return result;
                });
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
                return $.ajax({
                    type: "POST",
                    url: '' + that.serverAddress + '/run/' + that.targetXp + '/' + lock.run_id + '/unlock',
                    data: {
                        token: lock.token
                    },
                    async: async,
                    cache: false // usually useless, but who knows?
                }).then(function (result) {
                    // filters unused result arguments
                    return result;
                });
            });
            this._lockPromise = null;
            return this._unlockPromise;
        },

        get trials() {
            if (!this._trials) this._updateTrials();
            return this._trials;
        },

        _updateTrials: function () {
            var that = this,
                trials = this.run.then(function (run) {
                    return $.ajax({
                        url: that.serverAddress + '/run/' + run.experiment_id + '/' + run.id + '/trials',
                        dataType: 'json',
                        type: 'GET',
                        cache: false
                    }).then(function (result) {
                        // filters unused result arguments
                        return result;
                    });
                });
            // replace the getter so that the trials are got only once
            this._trials = trials;
            return trials;
        },

        get currentTrial() {
            var that = this;
            if (!that.connected) return null;
            var trials = this._trials || this._updateTrials();
            return $.when(trials, this._sendInit).then(function (trials) {
                if (that._currentTrialNum === null) {
                    for (var i = 0, n = trials.length; i < n; i++) {
                        var trial = trials[i];
                        if (!trial.completion_date) {
                            that._currentTrialNum = i;
                            return trial;
                        }
                    }
                } else {
                    return trials[that._currentTrialNum];
                }
            });
        },

        sendTrialResults: function (measures) {
            if (!this.connected) {
                throw "Not connected.";
            }
            var that = this;

            this._sendInit = $.when(this.currentTrial, this._currentPostRequest).then(
                function (currentTrialRes) {
                    return currentTrialRes;
                });

            // we need the run information, we make sure the run is locked, and that the last post
            // request is sent
            // we also need current trial
            var when = $.when(this.run, this._lock, this._sendInit),
                then = when.then(function (run, lock, currentTrial) {
                    var token = lock.token,

                        // build the address pass
                        path = [currentTrial.experiment_id,
                            currentTrial.run_id,
                            currentTrial.block_number,
                            currentTrial.number
                        ].join('/'),
                        address = that.serverAddress + '/trial/' + path,
                        // build the data
                        data = {
                            token: token,
                            run_id: currentTrial.run_id,
                            block_number: currentTrial.block_number,
                            trial_number: currentTrial.number,
                            experiment_id: currentTrial.experiment_id,
                            measures: measures
                        };


                    // post the data
                    return $.ajax({
                        type: 'POST',
                        url: address,
                        data: JSON.stringify(data),
                        contentType: 'application/json; charset=utf-8',
                        crossDomain: true,
                        dataType: 'json',
                        cache: false // usually useless, but who knows?
                    }).then(function (result) {
                        // filters useless ajax results
                        return result;
                    }).done(function () {
                        // cookie is set if we can lock the run
                        cookies.set('running-run-id', run.id, {
                            secure: false,
                            expires: 60 * 60 * 24
                        });
                    });
                });

            // registers the last post request
            this._currentPostRequest = then;
            this._currentTrialNum++;

            // force the current trial to be updated (will wait the end of the post request)
            // this._updateCurrentTrial();
            return this._currentPostRequest;
        }
    };

    return XpConnect;

});
