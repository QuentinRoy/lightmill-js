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
        'handlebars': 'libs/handlebars',
        'color': 'libs/color-0.4.4',
        'classy': 'libs/classy-modified',
        'spin': 'libs/spin',
        'purl': 'libs/purl'
    },
    packages: [
        {
            name: 'sigmamenu',
            location: 'packages/sigmamenu/src/',
            main: 'sigma-menu'
        },
        {
            name: 'toolbar',
            location: 'packages/toolbar',
            main: 'toolbar'
        }
    ],

    map: {
        '*': {
            'css': 'packages/require-css/css' // or whatever the path to require-css is
        }
    },

    shim: {
        handlebars: {
            exports: 'Handlebars'
        },
        
        purl: {
            deps: ['jquery'],
            exports: 'purl'
        },
        
        color: {
            exports: 'Color'
        },
    }
});


define(['xpclient/xp-manager', 'xpclient/trials/trials-manager', 'purl'], function (XpManager, TrialManager, purl) {
    'use strict';
    var url = purl(),
        targetRun = url.param('run'),
        trialManager = new TrialManager(),
        manager = new XpManager(trialManager, null, targetRun);
    manager.start();
});