/*jslint browser:true*/
/*global requirejs, define */

requirejs.config({
    enforceDefine: true,
    paths: {
        'jquery': 'libs/jquery-2.0.0',
        'raphaeljs': 'libs/raphael-arrow-fix',
        'text': 'libs/text',
        'jstools': 'packages/jstools/src',
        'templates': '../templates',
        'state-machine': 'libs/state-machine-modified',
        'signals': 'libs/signals',
        'cookies': 'libs/cookies',
        'underscore': 'libs/underscore',
        'color': 'libs/color-0.4.4',
        'classy': 'libs/classy-modified',
        'spin': 'libs/spin',
    },
    packages: [
        {
            name: 'sigmamenu',
            location: 'packages/sigmamenu/src/',
            main: 'sigma-menu'
        }
    ],
    shim: {
        underscore: {
            exports: '_'
        },

        color: {
            exports: 'Color'
        },
    }
});


define(['xpclient/xp-manager', 'xpclient/trials/trials-manager'], function (XpManager, TrialManager) {
    'use strict';
    var trialManager = new TrialManager(),
        manager = new XpManager(trialManager);
    manager.start();
});