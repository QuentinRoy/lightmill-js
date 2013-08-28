define(['./config', 'jquery', 'jstools/tools', 'cookies'], function (config, $, tools, cookies) {
    "use strict";

    function XpConnect(runId) {
        this.serverAddress = config.SERVER_ADDRESS;
        this.targetXp = config.TARGET_EXPERIMENT;
        this._run = null;
        this._lastRequestPromise = this._requestRun(runId);
        this._currentTrial = null;

    }

    XpConnect.prototype = {

        get currentTrial() {
            return this._currentTrial;
        },

        get runId() {
            return this._runId;
        },

        _requestRun: function (runId) {
            runId = runId || cookies.get('running-run-id');
            var address = tools.isUnset(runId) ?
                this.serverAddress + '/experiment/' + this.targetXp + '/next_run' :
                this.serverAddress + '/run/' + this.targetXp + '/' + runId,
                that = this;
            return $.get(address)
                .done(function (run) {
                that._run = run;
                if (run.completed) {
                    cookies.expire('running-run-id');
                } else {
                    cookies.set('running-run-id', run.id, {
                        secure: false,
                        expires: 60 * 60 * 24
                    });
                }
            }).fail(function () {
                throw 'Run request failed (' + address + ')';
            });
        },

        requestNextTrial: function () {
            // create a promise
            var dfd = $.Deferred(),
                that = this;
            // previous request must be done
            this._lastRequestPromise.done(function () {
                var address = that.serverAddress + '/run/' + that.targetXp + '/' + that._run.id + '/current_trial';
                // once the previous request is ok (usually immediately)
                // perform the request and update the premise accordingly
                $.get(address).done(function (trialinfo) {
                    that._currentTrial = trialinfo;
                    dfd.resolve(trialinfo);
                }).fail(function (answer) {
                    if (answer.status == 410) {
                        // check if the run is completed
                        that._requestRun(that._run.id).done(function (run) {
                            if (run.completed) {
                                dfd.resolve(null);
                            } else {
                                dfd.reject(answer);
                            }
                        });
                    } else {
                        dfd.reject(answer);
                    }
                });
            });
            // return the promise
            return dfd;
        },

        postTrialResults: function (trialResults) {
            // build the address pass
            var path = [this._currentTrial.experiment_id,
                        this._currentTrial.run_id,
                        this._currentTrial.block_number,
                        this._currentTrial.number].join('/'),
                address = this.serverAddress + '/trial/' + path,
                that = this;
            // previous request must be done
            this._lastRequestPromise.done(function () {
                that._lastRequestPromise = $.post(address, trialResults);
            });
        }

    };

    return new XpConnect();

});