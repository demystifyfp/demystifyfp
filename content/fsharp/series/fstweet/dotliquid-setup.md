---
title: "Setting Up Server Side Rendering using DotLiquid"
date: 2017-08-16T20:34:02+05:30
tags: [suave, DotLiquid, fsharp, forge]
---

Hi,

Welcome to the second part of [Creating a Twitter Clone in F# using Suave]({{< relref "intro.md">}}) series. 

In this post, we are going to extend our `FsTweet` app to render `Hello, World!` as HTML document from the server side using [DotLiquid](http://dotliquidmarkup.org/)

## Adding Packages References

Suave has [good support](https://suave.io/dotliquid.html) for doing server side rendering using DotLiquid. To make use of this in our project, we need to refer the associated NuGet packages in *FsTweet.Web.fsproj*.

Let's use Forge to add the required packages using Paket

```bash
> forge paket add DotLiquid -V 2.0.64
> forge paket add Suave.DotLiquid
```

> At the time of this writing, there are some breaking changes in the latest version of DotLiquid. As the current version of Suave.DotLiquid uses DotLiquid version `2.0.64`, we are sticking to the same here. 

The next step is referring these packages in the `FsTweet.Web.fsproj`.

To do this, add the package names in the *paket.references* file of *FsTweet.Web* project

```
...
DotLiquid
Suave.DotLiquid
```

> If you prefer to do the same from your bash, you can use the following commands
  ```bash
  > echo >> src/FsTweet.Web/paket.references #adds an empty new line
  > echo 'DotLiquid' >> src/FsTweet.Web/paket.references
  > echo 'Suave.DotLiquid' >> src/FsTweet.Web/paket.references
  ```

The last step is running the `forge install` command, an alias for the `paket install` command.

```bash
> forge install
```

This command adds the references of the NuGet packages provided in the *paket.references* file to the `FsTweet.Web.fsproj` file.

## Initializing DotLiquid

Now we have the required NuGet packages onboard

DotLiquid requires the following global initilization settings to enable us to render the [liquid templates](https://shopify.github.io/liquid/).

* A directory path which contains all our views 
* Naming Convention to be used when referring view models in the views. 

The [Suave.DotLiquid](https://www.nuget.org/packages/Suave.DotLiquid/) has helper functions to do this for us.

Let's have a directory called `views` in the `FsTweet.Web` project to put the liquid template files

```bash
> mkdir src/FsTweet.Web/views
```

The add a new function called `initDotLiquid`, which invokes the required helper functions to initialize DotLiquid to use this `views` directory for templates. 

```fsharp
// FsTweet.Web.fs
// ...
open Suave.DotLiquid
open System.IO
open System.Reflection

let currentPath =
  Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location)

let initDotLiquid () =
  let templatesDir = Path.Combine(currentPath, "views")
  setTemplatesDir templatesDir

[<EntryPoint>]
let main argv =
  initDotLiquid ()
  setCSharpNamingConvention ()
  // ...
```

By default, DotLiquid uses Ruby Naming Convention to refer the view model properties in the liquid template. For example, if you are passing a record type having a property `UserId` as a view model while using it in the liquid template, we have to use `user_id` instead of `UserId` to access the value. 

We are overriding this default convention by calling the `setCSharpNamingConvention` function from the `Suave.DotLiquid` library.  

## Updating Build Script To Copy Views Directory

With the above DotLiquid configuration in place, while running the `FsTweet.Web` application, we need to have the `views` directory in the current directory.

```
├── build
│   ├── ...
│   ├── FsTweet.Web.exe
│   └── views/
``` 

We can achieve it in two ways.

1. Adding the liquid templates files in the views directory to `FsTweet.Web.fsproj` file with the `Build Action` property as `Content` and `Copy to Output` property to either `Copy always` or `Copy if newer` as mentioned in the [project file properties](https://msdn.microsoft.com/en-us/library/0c6xyb66(v=vs.100).aspx) documentation. 

2. The second option is leveraging our build script to copy the entire `views` directory to the `build` directory.

We are going to use the latter one as it is a one time work rather than fiddling with the properties whenever we add a new liquid template file.

To do this let's add a new Target in the FAKE build script called `Views` and copy the directory the FAKE's `CopyDir` function

```fsharp
let noFilter = fun _ -> true

Target "Views" (fun _ ->
    let srcDir = "./src/FsTweet.Web/views"
    let targetDir = combinePaths buildDir "views"
    CopyDir targetDir srcDir noFilter
)
```

Then modify the build order to invoke `Views` Target before `Run`

```fsharp
// Build order
"Clean"
  ==> "Build"
  ==> "Views"
  ==> "Run"
```

That's it!

Now it's time to add some liquid templates and see it in action


## Defining And Rending DotLiquid Templates

The first step is defining a master page template with some placeholders.

Add a new file *master_page.liquid* in the `views` directory and update it as below

```html
<!-- src/FsTweet.Web/views/master_page.liquid -->
<!DOCTYPE HTML>
<html>
  <head>
    {% block head %}
    {% endblock %}
  </head>
  <body>
    <div id="content">
      {% block content %}
      {% endblock %}
    </div>
    <div id="scripts">
      {% block scripts %}
      {% endblock %}
    </div>		
  </body>
</html>
```

This `master_page` template defines three placeholders `head`, `content` and `scripts` which will be filled by its child pages.

The next step is adding a child page liquid template *guest/home.liquid* with some title and content

```html
{% extends "master_page.liquid" %}

{% block head %}
  <title> FsTweet - Powered by F# </title>
{% endblock %}

{% block content %}
<p>Hello, World!</p>
{% endblock %}
```

This guest home page template `extends` the `master_page` template and provides values for the `head` and `content` placeholders.

## Rendering Using Suave.DotLiquid

The final step is rendering the liquid templates from Suave.

The *Suave.DotLiquid* package has a function called `page` which takes a relative file path (from the templates root directory) and a view model and returns a WebPart

We just need to define the app using this `page` function. As the page is not using a view model we can use an empty string for the second parameter.

Let's also add a `path` filter in Suave to render the page only if the path is a root (`/`)

```fsharp
// FsTweet.Web.fs
// ...
open Suave.Operators
open Suave.Filters
// ...
[<EntryPoint>]
let main argv =
  initDotLiquid ()  
  let app = 
    path "/" >=> page "guest/home.liquid" ""
  startWebServer defaultConfig app
  0
```

Now if you build and run the application using the `forge run` command, you can see an HTML document with the `Hello, World!` content in the browser on *http://localhost:8080/*

## Summary

In this blog post, we have seen how to set up a Suave application to render server side views using DotLiquid and also how to make use of FAKE build script to manage static files. 

The source code is available on [GitHub repository](https://github.com/demystifyfp/FsTweet/tree/v0.1). 