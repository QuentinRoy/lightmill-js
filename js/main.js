/*jslint browser:true*/
/*global requirejs, define */

requirejs.config({
    enforceDefine: true,
    paths: {
        'jquery': ['http://code.jquery.com/jquery-2.0.0.min', 'libs/jquery-2.0.0'],
        'raphaeljs': 'libs/raphael-arrow-fix',
        'text': 'libs/text',
        'jstools': 'jstools/src',
        'templates': '../templates',
        'state-machine': 'libs/state-machine-modified',
        'signals': 'libs/signals',
        'cookies': 'libs/cookies'
    }
});


define(['xpclient/manager', 'xpclient/pretest-task'], function (Manager, PretestTask) {
    'use strict';
    var pretestTask = new PretestTask(),
        manager = new Manager(pretestTask);
    manager.start();
});