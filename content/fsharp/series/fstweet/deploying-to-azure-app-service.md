---
title: "Deploying to Azure App Service"
date: 2017-11-08T07:11:34+05:30
draft: true
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