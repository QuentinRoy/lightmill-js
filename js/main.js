/*jslint browser:true*/
/*global requirejs, define */

requirejs.config({
    enforceDefine: true,
    paths: {
        'jquery': 'libs/jquery-2.0.0',
        'raphaeljs': 'libs/raphael-arrow-fix',
        'text': 'libs/text',
        'jstools': 'jstools/src',
        'templates': '../templates',
        'state-machine': 'libs/state-machine-modified',
        'signals': 'libs/signals',
        'cookies': 'libs/cookies',
        'underscore': 'libs/underscore'
    },
    shim: {
        underscore: {
            exports: '_'
        }
    }
});


define(['xpclient/manager', 'xpclient/task-factory'], function (XpManager, TaskFactory) {
    'use strict';
    var taskFactory = new TaskFactory(),
        manager = new XpManager(taskFactory);
    manager.start();
});