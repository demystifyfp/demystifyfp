---
title: "Serving Static Asset Files"
date: 2017-08-19T07:36:20+05:30
tags: [suave, fsharp, FAKE]
---

Hi,

Welcome to the third part of the [Creating a Twitter Clone in F# using Suave]({{< relref "intro.md">}}) blog post series.

In this post, we will be changing the guest homepage from displaying `Hello, World!` to a production ready landing page!

![Guest Home Page](/img/fsharp/series/fstweet/guest-home-page.png)

## Preparing Static Asset Files

As a first step let's create an assets directory in *FsTweet.Web* and place our static asset files. The asset files can be downloaded from the [repository](https://github.com/demystifyfp/FsTweet/tree/v0.2/src/FsTweet.Web/assets)

```bash
└── FsTweet.Web
    ├── FsTweet.Web.fs
    ├── FsTweet.Web.fsproj
    ├── assets
    │   ├── css
    │   │   └── styles.css
    │   └── images
    │       ├── FsTweetLogo.png
    │       └── favicon.ico
    ├── ...
```

## Modifying Master Page and Guest Home Templates

Then we need to change our liquid templates to use these assets

```html
<!-- view/master_page.liquid -->
<head>
  <!-- ... -->
  <link rel="stylesheet" href="assets/css/styles.css">
</head>
```

```html
<!-- view/guest/home.liquid -->
<!-- ... -->
{% block content %}
<!-- ... -->
<div class="jumbotron">
   <img src="assets/images/FsTweetLogo.png" width="400px"/>
   <p class="lead">Communicate with the world in a different way!</p>
   <!-- ... -->
</div>
{% endblock %}
```

For simplicity, I am leaving the other static content that is modified in the templates, and you can find all the changes in [this diff](https://github.com/demystifyfp/FsTweet/commit/ae233c5407900b32af682407d902621e0a17bd38#diff-62ccd7caf19fda6d153b1958919d1f9d)

## Updating Build Script To Copy Assets Directory

As we seen during the [dot liquid setup]({{< relref "dotliquid-setup.md#updating-build-script-to-copy-views-directory" >}}), we need to add an another Target `Assets` to copy the *assets* directory to the *build* directory

```fsharp
let copyToBuildDir srcDir targetDirName =
  let targetDir = combinePaths buildDir targetDirName
  CopyDir targetDir srcDir noFilter

Target "Assets" (fun _ ->
  copyToBuildDir "./src/FsTweet.Web/assets" "assets"
)
```

Then modify the build order to run this Target before the `Run` Target.

```fsharp
// Build order
"Clean"
==> "Build"
==> "Views"
==> "Assets"
==> "Run"
```

## Serving Asset Files 

Now we have the assets available in the build directory. The next step is serving them Suave in response to the request from the browser. 

Suave has a lot of [useful functions](https://suave.io/Suave.html#def:module Suave.Files) to handle files, and in our case, we are going to make use of the [browseHome](https://suave.io/Suave.html#def:val Suave.Files.browseHome) function to serve the assets

> 'browse' the file in the sense that the contents of the file are sent based on the request's Url property. Will serve from the current as configured in directory. Suave's runtime. - Suave Documentation

The current directory in our case is the directory in which the *FsTweet.Web.exe* exists. i.e *build* directory.

```fsharp
// FsTweet.Web.fs
// ...
open Suave.Files

// ...
let serveAssets =
  pathRegex "/assets/*" >=> browseHome

[<EntryPoint>]
let main argv =
  // ...
  let app = 
    choose [
      serveAssets
      path "/" >=> page "guest/home.liquid" ""
    ]
    
  startWebServer defaultConfig app
```

We have made two changes here.

* The `serveAssets` defines a new [WebPart](https://theimowski.gitbooks.io/suave-music-store/content/en/webpart.html) using the [pathRegex](https://suave.io/Suave.html#def:val Suave.Filters.pathRegex). It matches all the requests for the assets and serves the corresponding files using the `browseHome` function.

* As we are handling more than one requests now, we need to change our `app` to handle all of them. Using the [choose](https://suave.io/composing.html) function, we are defining the `app` to combine both `serveAssets` webpart and the one that we already had for serving the guest home page. 


## Serving favicon.ico

While serving our *FsTweet* application, the browser automatically makes a request for [favicon](https://en.wikipedia.org/wiki/Favicon). As the URL path for this request is `/favicon.ico` our `serveAssets` webpart cannot match this. 

To serve it we need to use an another specific path filter and use the [file](https://suave.io/Suave.html#def:val Suave.Files.file) function to get the job done.


```fsharp
// FsTweet.Web.fs
// ...
let serveAssets =
  let faviconPath = 
    Path.Combine(currentPath, "assets", "images", "favicon.ico")
  choose [
    pathRegex "/assets/*" >=> browseHome
    path "/favicon.ico" >=> file faviconPath
  ]
//...
```

## Summary

In this blog post, we learned how to serve static asset files in Suave. The source code can be found in the [GitHub repository](https://github.com/demystifyfp/FsTweet/tree/v0.2) 