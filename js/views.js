
/**
 * Views
 *
 * Ractive classes can be extended but we still need a number of
 * things at instantian, like templates
 */
define('views', ['underscore', 'Ractive', 'helpers'],
  function(_, Ractive, helpers) {
  var views = {};

  // Base view to extend from
  views.Base = Ractive.extend({
    baseInit: function(options) {
      this.router = options.router;
    }
  });

  // View for application container
  views.Application = views.Base.extend({
    init: function() {
      this.baseInit.apply(this, arguments);

      // Watch for any changes to the words and count correctness
      this.observe('words', function(nV, oV) {
        var words = this.get('words');

        this.set('wordCount', _.size(words));
        this.set('correctCount', _.reduce(words, function(total, w) {
          return total + (w.get('correct') ? 1 : 0);
        }, 0));
      });
    }
  });

  // Return what we have
  return views;
});
