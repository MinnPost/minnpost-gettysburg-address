/**
 * RequireJS config which maps out where files are and shims
 * any non-compliant libraries.
 */
require.config({
  baseUrl: 'js',
  shim: {
    'underscore': {
      exports: '_'
    },
    'Backbone': {
      deps: ['underscore', 'jquery'],
      exports: 'Backbone'
    },
    'easydropdown': 'jquery'
  },
  paths: {
    'requirejs': '../bower_components/requirejs/require',
    'text': '../bower_components/text/text',
    'jquery': '../bower_components/jquery/jquery.min',
    'underscore': '../bower_components/underscore/underscore-min',
    'Backbone': '../bower_components/backbone/backbone-min',
    'Ractive': '../bower_components/ractive/build/Ractive-legacy.min',
    'Ractive-Backbone': '../bower_components/ractive-backbone/Ractive-Backbone.min',
    'store': '../bower_components/store.js/store+json2.min',
    // Since we are using a forked version, the minified version has not been
    // built
    'easydropdown': '../bower_components/easydropdown/src/jquery.easydropdown',
    'minnpost-gettysburg-address': 'app'
  }
});
