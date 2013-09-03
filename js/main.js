/*jslint browser:true*/
/*global requirejs, define */

requirejs.config({
    enforceDefine: true,
    paths: {
        'jquery': 'libs/jquery-2.0.0',
        'raphaeljs': 'libs/raphael-arrow-fix',
        'text': 'libs/text',
        'jstools': 'modules/jstools/src',
        'templates': '../templates',
        'state-machine': 'libs/state-machine-modified',
        'signals': 'libs/signals',
        'cookies': 'libs/cookies',
        'underscore': 'libs/underscore',
        'color': 'libs/color-0.4.4',
        'classy': 'libs/classy'
    },
    packages: [
        {
            name: 'sigmamenu',
            location: 'modules/sigmamenu/src/',
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


define(['xpclient/manager', 'xpclient/tasks/task-factory'], function (XpManager, TaskFactory) {
    'use strict';
    var taskFactory = new TaskFactory(),
        manager = new XpManager(taskFactory);
    manager.start();
});