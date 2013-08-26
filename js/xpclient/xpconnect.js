define(['./config', 'jquery'], function (config, $) {
    "use strict";

    function XpConnect() {
        this.serverAddress = config.SERVER_ADDRESS;
        this.targetXp = config.TARGET_EXPERIMENT;
        this.runId = null;

        this._runRequestPromise = this._requestRun();

    }

    XpConnect.prototype = {

        get ready() {
            return this.runId !== null;
        },

        _requestRun: function () {
            var address = this.serverAddress + '/experiment/' + this.targetXp + '/next_run';
            return $.get(address)
                .done($.proxy(this._set_run, this))
                .fail(function () {
                throw 'Run request failed (' + address + ')';
            });
        },

        _setRun: function (runId) {
            this.runId = runId;
        },

        requestNextTrial: function () {
            var dfd = $.Deferred(),
                address = this.serverAddress + '/run/' + this.targetXp + '/' + this.runId + '/current_trial';
            this._runRequestPromise.done(function () {
                $.get(address).done(function (trial) {
                    dfd.resove(trial);
                });
            });
            return dfd;
        },

    };

    return new XpConnect();

});