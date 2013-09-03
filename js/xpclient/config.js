/*jslint nomen: true, browser:true*/
/*global define */

(function () {
    "use strict";

    define({
        SERVER_ADDRESS: 'http://' + window.location.host + ':5000',
        TARGET_EXPERIMENT: 'nonmode',
        DEBUG: {
            managerfsm: true
        }
    });

}());