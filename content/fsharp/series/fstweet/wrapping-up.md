---
title: "Wrapping Up"
date: 2017-11-14T06:42:51+05:30
draft: true
---

Hi,

Thank you for joining me in the quest of developing a real world application using functional programming principles in F#. I belived it has added value to you. 

Let's have a quick recap what we have done so far and discuss the journey ahead before we wrap up [this blog post series]({{< relref "intro.md">}}). 


## Code Organization

Here is the architectural (colourful!) diagram of our FsTweet Application. 

![](/img/fsharp/series/fstweet/fstweet_10_000_ft_view.png)

The black ellipses represent the business use cases and the red circles at the top represent the common abstractions. 

It is an opinionated approach based on the software development principle, [high cohesion and loose coupling](https://thebojan.ninja/2015/04/08/high-cohesion-loose-coupling/). 

Organizing the code around business use cases give us a clarity while trying to understand the system. 

> The code is more often read than written.

![](/img/fsharp/series/fstweet/code_organization_tree.png)

## The Composition Root

We used the [Composition Root Pattern](http://blog.ploeh.dk/2011/07/28/CompositionRoot/) to glue the different modules together. 

> Where should we compose object graphs? 

> As close as possible to the application's entry point.

> A Composition Root is a (preferably) unique location in an application where modules are composed together - [Mark Seemann](https://twitter.com/ploeh)

The Composition Root pattern along with [dependency injection through partial application](https://fsharpforfunandprofit.com/posts/dependency-injection-1/) provided us the foundation for our application. 

In FsTweet, the `main` function is the composition root for the entire application

![](/img/fsharp/series/fstweet/composition_root.png)

Then for each business use case, the presentation layer Suave's `webpart` function is the composition root. 

![](/img/fsharp/series/fstweet/usecase_composition_root.png)

There are other patterns like [Free Monad](http://blog.ploeh.dk/2017/08/07/f-free-monad-recipe/) and [Reader Monad](https://www.youtube.com/watch?v=xPlsVVaMoB0) to solve this in a different way. For our use case, the approach that we used helped us to get the job done without any complexties. 

<blockquote class="twitter-tweet" data-lang="en-gb"><p lang="en" dir="ltr">The free monad series by <a href="https://twitter.com/ploeh?ref_src=twsrc%5Etfw">@ploeh</a> is excellent. Still, I think free monads, esp. in F#, are solving a non-problem in overly complicated way.</p>&mdash; Tomas Petricek (@tomaspetricek) <a href="https://twitter.com/tomaspetricek/status/892037756041523204?ref_src=twsrc%5Etfw">31 July 2017</a></blockquote>
<script async src="https://platform.twitter.com/widgets.js" charset="utf-8"></script>

Being said that, the context always wins. For the application that we took, it made sense. The Free Monad and Reader Monad approaches suit well for certain kind of problems. Hence, my recommendation would be, learn all the approaches, pick the one that suits your project and [keep it simple](https://www.infoq.com/presentations/Simple-Made-Easy). 

I encourage you to try Free Monad and Reader Monad apporaches with the FsTweet codebase and do let me know once you are done. It'd be a good resource for entire fsharp community!
 
## The Journey Ahead

There are lot of ways, we can modify/extend/play with FsTweet. 

* Replacing Suave with [Freya](https://freya.io/), [Girafee](https://github.com/dustinmoris/Giraffe), [ASP.NET Core](https://docs.microsoft.com/en-us/aspnet/core/) 

* Replacing SQLProvider with [Rezoom.SQL](https://github.com/rspeele/Rezoom.SQL) or [Entity Framework](https://docs.microsoft.com/en-us/ef/core/)

* Replacing GetStream.io with [F# Agents](https://fsharpforfunandprofit.com/posts/concurrency-actor-model/) or [Akka.Net](http://getakka.net/) with [Event Source](https://developer.mozilla.org/en-US/docs/Web/API/EventSource)

* Features like, suggesting whom to follow (Machine Learning!), highlights, hashtag based searching, unfollow and much more. You can even change the character limit to 280 characters!

Do drop a note when you make any of these or something else that you found fun and meaningful

Once again thanks for joining me :)

> There are two ways of spreading light: to be the candle or the mirror that reflects it. - Edith Wharton