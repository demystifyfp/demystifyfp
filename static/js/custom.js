$(function () {
  $("a").attr('target', '_blank');
  $("b.conum").each(function (i, e) {
    var $e = $(e)
    var content = $e.html().replace("(", "").replace(")", "")
    $e.html(content)
    $span = $e.children('span')
    $span.attr('style', 'color:#fff !important')
  })
  $(".colist").children('ol').addClass('custom-counter')

  var level = 0
  Prism.hooks.add('wrap', function (env) {
    if (env.language == "clojure" && env.type == "punctuation") {
      if (env.content == "(" || env.content == "[" || env.content == "{") {
        level++;
        env.classes.push("rbl" + level);
      }
      if (env.content == ")" || env.content == "]" || env.content == "}") {
        env.classes.push("rbl" + level);
        level--;
      }
    }
  });
});