
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
      this.app = this.router.app;

      // Clear local storage
      this.on('clearStorage', function(e) {
        e.original.preventDefault();
        this.app.clearStorage();
      });
    }
  });

  // View for application container
  views.Application = views.Base.extend({
    init: function() {
      this.baseInit.apply(this, arguments);

      // Watch for any changes to the words and count correctness
      this.observe('words', function(nV, oV) {
        var words = this.get('words');
        var answers = {};

        // Update word counts
        this.set('wordCount', _.size(words));
        this.set('correctCount', _.reduce(words, function(total, w) {
          return total + (w.get('correct') ? 1 : 0);
        }, 0));

        // Save answer set
        _.each(words, function(w) {
          answers[w.id] = w.get('answer');
        });
        this.app.setStorage(answers);
      });
    }
  });

  // Return what we have
  return views;
});
