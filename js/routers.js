/**
 * Routers
 */
define('routers', [
  'underscore', 'Backbone', 'Ractive', 'Ractive-Backbone',
  'helpers', 'models', 'collections', 'views',
  'text!templates/application.mustache',
  'text!templates/loading.mustache',
  'text!templates/word.mustache'
], function(_, Backbone, Ractive, RactiveBackbone,
    helpers, models, collections, views,
    tApplication, tLoading, tWord) {
  var routers = {};

  // Base model
  routers.Router = Backbone.Router.extend({
    views: {},
    collections: {},
    models: {},
    data: {},

    initialize: function(options) {
      this.options = options;
      this.app = options.app;

      // Create data object.  We don't use a collection as it makes
      // it much easier to refer to words by the Id
      this.data.words = {};
      _.each(options.words, function(w) {
        this.data.words[w.id] = new models.Word(w);
      }.bind(this));

      // Create application view
      this.views.application = new views.Application({
        el: this.app.$el,
        template: tApplication,
        data: {
          words: this.data.words
        },
        router: this,
        partials: {
          loading: tLoading,
          word: tWord
        },
        adaptors: [ 'Backbone' ]
      });
    },

    routes: {
      'addressQuiz': 'routeAddressQuiz',
      '*default': 'routeDefault'
    },

    start: function() {
      Backbone.history.start();
    },

    routeDefault: function() {
      this.navigate('/addressQuiz', { trigger: true, replace: true });
    },

    routeAddressQuiz: function() {
      // Handle quiz
    }
  });

  // Return what we have
  return routers;
});
