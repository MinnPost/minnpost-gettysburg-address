/**
 * Models
 */
define('models', ['underscore', 'Backbone', 'helpers'],
  function(_, Backbone, helpers) {
  var models = {};

  // Override backbone's ajax request for use with JSONP
  // which is not preferred but we have to support
  // older browsers
  Backbone.ajax = helpers.BackboneAJAX;

  // Base model
  models.Base = Backbone.Model.extend({
    initialize: function(data, options) {
      // Attach options
      this.options = options || {};
      this.app = options.app;
    }

  });

  // Word
  models.Word = Backbone.Model.extend({
    initialize: function(data, options) {
      models.Word.__super__.initialize.apply(this, arguments);

      // Add options together and randomize
      data.options.push(data.word);
      data.options = _.sample(data.options, data.options.length);
      this.set('options', data.options);
    }
  });

  // Return what we have
  return models;
});
