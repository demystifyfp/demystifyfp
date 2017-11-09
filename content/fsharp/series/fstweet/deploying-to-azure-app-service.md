---
title: "Deploying to Azure App Service"
date: 2017-11-08T07:11:34+05:30
draft: true
tags: ["FAKE", "azure"]
---

Hi There!

It's great to see you back in the twenty first part of [Creating a Twitter Clone in F# using Suave](TODO) blog post series. 

In this blog post, we are going to prepare our code for deployment and we'll be deploying our FsTweet Application in Azure using [Azure App Service](https://azure.microsoft.com/en-in/services/app-service/)

Let's dive in.


## Revisiting Database Interaction

The first place that we need to touch to prepare FsTweet for deployment is *Db.fs*. Especially, the below lines in this file

```fsharp
[<Literal>]
let private connString = 
  "Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=test;"
```

The SQLProvider [requires connection string](http://fsprojects.github.io/SQLProvider/core/parameters.html) should be available [during compile time](http://fsprojects.github.io/SQLProvider/core/parameters.html) in order to create types from the database to which it is connected to. 

In other words, we need a live database (with schemas defined) to compile the FsTweet. 

In our build script, we are running the migration script to create/modify the tables before compilation of the application. So, we don't need to worry about the database schema. 

Similarly, In runtime, we are getting the connection string from an environment variable and using it to initialize the database connection

```fsharp
// src/FsTweet.Web/FsTweet.Web.fs
// ...
let main argv =
  // ...
  let fsTweetConnString = 
   Environment.GetEnvironmentVariable  "FSTWEET_DB_CONN_STRING"
  // ...
  let getDataCtx = dataContext fsTweetConnString
  // ...
```

The real concern is if we are going with the current code as it is, while compiling the code on a cloud machine, that machine has to have a local postgres database which can be accessed using the above connection string literal. 


We can have a separate database (accessible from anywhere) for this purpose alone and uses that as a literal. But there are lot of drawbacks!

* Now we need to maintain two databases, one for compilation and another one for running in production

* It means our migration script has to run on both the databases.

* We also need to makes sure that the database schema should be same in both the databases. 


It's lot of work(!) for an obvious task! So, this approach is not practical. 

Before arriving at the solution, Let's think about what would be an ideal scenario.

1. Provision a production ready PostgreSQL database
2. Set the connection string of this database as the value of environment varialbe `FSTWEET_DB_CONN_STRING`
3. Run the migration script
4. Compile (Build) the application
5. Run the application

The first step is manual and the rest of the steps are already taken care by our FAKE build script.

> We'll be adding a separate step in our build script to run the application on cloud. 

To make this ideal scenario work, we need an intermediate step between three and four, which takes the connection string from the environment variable and replaces the connection string literal in *Db.fs* with this one. After successful compilation, we need to revert this change. 

It's super easy with our build script. Let's make it work!

We are already having the local connection string in the build script which we are using if there is no value in the `FSTWEET_DB_CONN_STRING` environment variable.

```fsharp
let connString = 
  environVarOrDefault 
    "FSTWEET_DB_CONN_STRING"
    @"Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=test;"
```

Let's extract this out and define a binding for this value

```diff
+ let localDbConnString = 
+   @"Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=test;"

let connString = 
  environVarOrDefault 
    "FSTWEET_DB_CONN_STRING"
-   @"Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=test;"
+   localDbConnString
```

Then add a build target, to verify the presence of this connection string in the *Db.fs* file.

```fsharp
// build.fsx
// ...
let dbFilePath = "./src/FsTweet.Web/Db.fs"

Target "VerifyLocalDbConnString" (fun _ ->
  let dbFileContent = File.ReadAllText dbFilePath
  if not (dbFileContent.Contains(localDbConnString)) then
    failwith "local db connection string mismatch"
)
// ...
```

We are adding this target, to ensure that the local database connection string that we have it here is same as that of in *Db.fs* file before replacing it.

Let's define a helper function `swapDbFileContent`, which swaps the connection string

```fsharp
// build.fsx
// ...
let swapDbFileContent (oldValue: string) (newValue : string) =
  let dbFileContent = File.ReadAllText dbFilePath
  let newDbFileContent = dbFileContent.Replace(oldValue, newValue)
  File.WriteAllText(dbFilePath, newDbFileContent)
// ...
```

Then add two targets in the build target, one to change the connection string and an another one to revert the change.

```fsharp
// build.fsx
// ...
Target "ReplaceLocalDbConnStringForBuild" (fun _ -> 
  swapDbFileContent localDbConnString connString
)
Target "RevertLocalDbConnStringChange" (fun _ -> 
  swapDbFileContent connString localDbConnString
)
// ...
```

As a last step, alter the build order to leverage the targets that we created just now.

```diff
  // Build order
  "Clean"
  ==> "BuildMigrations"
  ==> "RunMigrations"
+ ==> "VerifyLocalDbConnString"
+ ==> "ReplaceLocalDbConnStringForBuild"
  ==> "Build"
+ ==> "RevertLocalDbConnStringChange"
  ==> "Views"
  ==> "Assets"
  ==> "Run"
```

That's it!

## Supporting F# Compiler 4.0

At the time of this writing, The F# Compiler version that has been supported by Azure App Service is 4.0. But we developed the application using F# 4.1. So, we have to compile our code using F# 4.0 before deploying.

When we compile our application using F# 4.0 compiler, we'll get an compiler error

```bash
...\FsTweet.Web\Json.fs(17,41): 
  Unexpected identifier in type constraint. 
Expected infix operator, quote symbol or other token.
```

The piece of code that is bothering here is this one 

```fsharp
let inline deserialize< ^a when (^a or FromJsonDefaults) 
                          : (static member FromJson: ^a -> ^a Json)> 
                          req : Result< ^a, string> =
  // ...
```

If you check out the [release notes of F# 4.1](https://blogs.msdn.microsoft.com/dotnet/2017/03/07/announcing-f-4-1-and-the-visual-f-tools-for-visual-studio-2017-2/), you can find there are some improvements made on Statically Resolved Type Parameter support to fix this error (or bug).

Fortunately, rest of codebase are in tact with F# 4.0 and we just need to fix this one. 

As a first step, comment out the `deserialize` function in the `JSON` module and the add the following new implementation.

```fsharp
// src/FsTweet.Web/Json.fs
// ...

// Json -> Choice<'a, string> -> HttpRequest -> Result<'a, string>
let deserialize tryDeserialize req =
  parse req
  |> bind (fun json -> tryDeserialize json |> ofChoice)
```

This new version of the `deserialize` is similar to the old one except that we are going to get the function `Json.tryDeserialize` as a parameter (`tryDeserialize`) instead of using it directly inside the function. 

Then we have to update the places where this function is being used

```diff
// src/FsTweet.Web/Social.fs
...
let handleFollowUser (followUser : FollowUser) (user : User) ctx = async {	
- match JSON.deserialize ctx.request with
+ match JSON.deserialize Json.tryDeserialize ctx.request with
  ...
```

```diff
// src/FsTweet.Web/Social.fs
...
let handleNewTweet publishTweet (user : User) ctx = async {
- match JSON.deserialize ctx.request with
+ match JSON.deserialize Json.tryDeserialize ctx.request  with
  ...
```

## Http Bindings

We are currently using default HTTP bindings provided by Suave. So, when we run our application locally, the web server will be listening on the default port `8080`. 

But when we are running it in Azure or in any other cloud vendor, we have to use the port providing by them.

In addition to that, the default HTTP binding uses the loopback address `127.0.0.1` instead of `0.0.0.0` which makes it [non-accessible](https://stackoverflow.com/questions/20778771/what-is-the-difference-between-0-0-0-0-127-0-0-1-and-localhost) from the other hosts. 

We have to fix both of these, in order to run our application in cloud. 

```diff
// src/FsTweet.Web/FsTweet.Web.fs
// ...
open System.Net
// ...
let main argv = 
  // ...

+ let ipZero = IPAddress.Parse("0.0.0.0")
  
+ let port = 
+   Environment.GetEnvironmentVariable "PORT"

+ let httpBinding =
+   HttpBinding.create HTTP ipZero (uint16 port)

  let serverConfig = 
    {defaultConfig with 
-     serverKey = serverKey}
+     serverKey = serverKey
+     bindings=[httpBinding]}
```

We are getting the port number to listen from the environment variable `PORT` and modifying the `defaultConfig` to use the custom http binding instead of the default one. 

> In Azure App Service, the port to listen is already available in the environment variable `HTTP_PLATFORM_PORT`. But we are using `PORT` here to avoid cloud vendor specific stuffs in the codebase. Later via configuration (outside the codebase), we will be mapping these environment variables.   

## The web.config File

[As mentioned](https://suave.io/azure-app-service.html) in Suave's documention, we need to have a web.config to instruct IIS to route the traffic to Suave.

Create a new file *web.config* in the root directory and update it as below

```bash
> touch web.config
```

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>

    <handlers>
      <remove name="httpplatformhandler" />
      <add
        name="httpplatformhandler"
        path="*"
        verb="*"
        modules="httpPlatformHandler"
        resourceType="Unspecified"
      />
    </handlers>

    <httpPlatform 
      stdoutLogEnabled="false"
      startupTimeLimit="20" 
      processPath="%HOME%\site\wwwroot\FsTweet.Web.exe"
      >

      <environmentVariables>
        <environmentVariable name="PORT" value="%HTTP_PLATFORM_PORT%" />
      </environmentVariables>
    </httpPlatform>
    
  </system.webServer>
</configuration>
```

Most of the above content was copied from the documentation and we have modified the following

* `processPath` - specifies the location of the `FsTweet.Web` executable. 
* `environmentVariables` - creates a new envrionment variable `PORT` with the value from the environment variable `HTTP_PLATFORM_PORT`.
* `stdoutLogEnabled` - disables *stdout* log. (We'll revisit it the next blog post)

## Revisiting Build Script

To deploy FsTweet on Azure App Service we are going to use [Kudu](https://github.com/projectkudu). FAKE library has good support for Kudu and we can deploy our application right from our build script.

FAKE library provides a `kuduSync` function which copies with semantic appropriate for deploying web site files. Before calling `kuduSync`, we need to stage the files (in a temporary directory) that has to be copied. This staging directory path can be retrieved from the FAKE Library's `deploymentTemp` binding. Then the `kuduSync` function sync the files for deployment. 

The `deploymentTemp` directory is exact replica of our local `build` directory on the deloyment side. So, instead of staging the files explicitly, we can use this directory as build directory. An another benefit is user account which will be deploying has full access to this directory.

To do the deployment from our build script, we first need to know what is the environment that we are in through the environment variable `FSTWEET_ENVIRONMENT`.

```fsharp
// build.fsx
// ...
open Fake.Azure

let env = environVar "FSTWEET_ENVIRONMENT" 
```

Based on this `env` value, we can set the build directory.

```diff
// build.fsx
// ...

let env = environVar "FSTWEET_ENVIRONMENT" 

- // Directories		
- let buildDir  = "./build/"		
- let deployDir = "./deploy/"

+ let buildDir  = 
+   if env = "dev" then 
+     "./build" 
+   else 
+     Kudu.deploymentTemp

// ...

  Target "Clean" (fun _ ->
-   CleanDirs [buildDir; deployDir]		
+   CleanDirs [buildDir]
  )
```

For dev environment, we'll be using `./build` as build directory and `Kudu.deploymentTemp` as build directory in the other environments. We've also removed the `deployDir` (that was part of the auto-genrated build file) as we are not using it.

Then we need to two more targets

```fsharp
// build.fsx
// ...

Target "CopyWebConfig" ( fun _ ->
  FileHelper.CopyFile Kudu.deploymentTemp "web.config")

Target "Deploy" Kudu.kuduSync

// ...
```

The `CopyWebConfig` copies the `web.config` to the `Kudu.deploymentTemp` directory (aka staging directory). 

The `Deploy` just calls the `Kudu.kuduSync` function. 

The last thing that we need to revist in the build script is the build order. 

We need two build orders. One to run the application locally (which we already have) and another one to deploy. In the latter case, the we don't need to run the application explicitly as Azure Web App takes cares of executing our application using the *web.config* file. 

To make it possible, Replace the existing build order with the below one

```fsharp
// build.fsx
// ...

// Build order
"Clean"
==> "BuildMigrations"
==> "RunMigrations"
==> "VerifyLocalDbConnString"
==> "ReplaceLocalDbConnStringForBuild"
==> "Build"
==> "RevertLocalDbConnStringChange"
==> "Views"
==> "Assets"


"Assets"
==> "Run"

"Assets"
==> "CopyWebConfig"
==> "Deploy"
```

Now we have two different Target execution hiearchy. Refer [this detailed documentation](https://fake.build/legacy-core-targets.html) to know how the order hierarchy works in FAKE. 

## PostgreSQL Database Setup

To run FsTweet on cloud, we need to have a database on the cloud. We can make use of [ElephantSQL](https://www.elephantsql.com/) which provides a [free plan](https://www.elephantsql.com/plans.html). 

Create a new free database instance in ElephantSQL and note down its credentails to pass it as a connection string to our application. 

![ElephantSQL credentials](/img/fsharp/series/fstweet/elephant_sql_credentials.png)

## GetStream.io Setup

Next thing that we need to set up is *GetStream.io*. Create a new app called *fstweet*.

![GetStream New App Creation](/img/fsharp/series/fstweet/getstream_new_app.png)

And create two *flat feed* groups, `user` and `timeline`.

![](/img/fsharp/series/fstweet/getstream_new_feed.png)

![](/img/fsharp/series/fstweet/getstream_feeds.png)

After creation keep a note of the App Id, Key and Secret

![](/img/fsharp/series/fstweet/getstream_key_and_secret.png)

