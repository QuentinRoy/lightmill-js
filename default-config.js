(function() {
    "use strict";

    define({
        serverAddress: 'http://' + window.location.host + ':5000',
        // targetExperiment: 'test', // deprecated
        experiment: 'test',
        mainDiv: "#main-div",
        debug: {
            managerfsm: false
        }
    });

}());
