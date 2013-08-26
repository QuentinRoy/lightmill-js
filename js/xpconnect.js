define(['config', 'jquery'], function (config, $) {

    function XpConnect() {
        this.serverAddress = config.SERVER_ADDRESS;
        this.targetXp = config.TARGET_EXPERIMENT;
        this.runId = null;

        this._request_run();
    }

    XpConnect.prototype = {

        _request_run: function () {
            var address = this.serverAddress + '/experiment/' + this.targetXp + '/next_run';
            $.get(address).done($.proxy(this._set_run, this)).fail(function () {
                console.log('Cannot get target run for experiment ' + this.targetXp + ' at ' + address);
            });
        },

        _set_run: function (runId) {
            this.runId = runId;
        }
    };

    return new XpConnect();

});