
/**
 * Views
 *
 * Ractive classes can be extended but we still need a number of
 * things at instantian, like templates
 */
define('views', ['jquery', 'underscore', 'Ractive', 'easydropdown', 'helpers'],
  function($, _, Ractive, easydropdown, helpers) {
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
      var thisView = this;
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

      // Enable dropdowns if needed.  We have to hack
      // around the answer updating because this (and other
      // libraries) mangle up our original DOM object.
      $(this.el).find('select').easyDropDown({
        onChange: function(selected) {
          thisView.set('words.' + $(this).data('wordId') + '.answer', selected.value);
        }
      });
      // We also have to hack around the fact that the option classes
      // do not carry over
      $(this.el).find('select option').each(function() {
        $option = $(this);
        $option.parent().parent().parent().find('ul li').each(function() {
          $li = $(this);
          if ($li.html() === $option.html()) {
            $li.addClass($option.attr('class'));
          }
        });
      });

      // Show score event
      this.on('showCorrect', function(e) {
        e.original.preventDefault();
        $(this.el).find('.correctness-action').slideUp();
        $(this.el).find('.correctness-score').slideDown();

        _.each(this.data.words, function(w) {
          w.set('graded', true);
        });
      });
    }
  });

  // Return what we have
  return views;
});
