---
title: "Deploying to Azure App Service"
date: 2017-11-08T07:11:34+05:30
tags: ["FAKE", "azure", "fsharp", "suave"]
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

## Invoking Build Script

We have a build script that automates all the required activities to do the deployment. But, who is going to run the this script in the first place?

That's where [.deployment file](https://github.com/projectkudu/kudu/wiki/Customizing-deployments#deployment-file) comes into picture. 

Usign this file, we can specify what command to run to deploy the application in Azure App Service.

Let's create this file in the application's root directory and update it to invoke the build script.

```bash
> touch .deployment
```

```ini
[config]
command = build.cmd Deploy
```

> The *build.cmd* was created by Forge during project initialization.

With this we are done with all the coding changes that are required to perform the deployment. 

## PostgreSQL Database Setup

To run FsTweet on cloud, we need to have a database on the cloud. We can make use of [ElephantSQL](https://www.elephantsql.com/) which provides a [free plan](https://www.elephantsql.com/plans.html). 

Create a new free database instance in ElephantSQL and note down its credentails to pass it as a connection string to our application. 

![ElephantSQL credentials](/img/fsharp/series/fstweet/elephant_sql_credentials.png)

## GetStream.io Setup

Next thing that we need to set up is *GetStream.io* as we can't use the one that we used during development.

Create a new app called *fstweet*.

![GetStream New App Creation](/img/fsharp/series/fstweet/getstream_new_app.png)

And create two *flat feed* groups, `user` and `timeline`.

![](/img/fsharp/series/fstweet/getstream_new_feed.png)

![](/img/fsharp/series/fstweet/getstream_feeds.png)

After creation keep a note of the App Id, Key and Secret

![](/img/fsharp/series/fstweet/getstream_key_and_secret.png)


## Postmark Setup

Regarding Postmark, we don't need to create a [new server](https://account.postmarkapp.com/servers) account as we are not using it in development environment. 

However, we have to modify the [signup email template]({{<relref "sending-verification-email.md#configuring-signup-email-template">}}) to the use the URL of the deployed application instead of the localhost URL. 

```diff
-  http://localhost:8080/signup/verify/{{ verification_code }}
+  http://fstweet.azurewebsites.net/signup/verify/{{ verification_code }}
```


## Create Azure App Service

With all the dependent services are up, our next focus is deploying the application in azure app service.

To deploy the application, we are going to use [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/get-started-with-azure-cli?view=azure-cli-latest). It offers an convinent way to manage azure resource easily from the command line. 

Make sure, you are having this [CLI installed](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli?view=azure-cli-latest) in your machine as well as [an active Azure Subscription](https://azure.microsoft.com/en-us/free/)

The first thing that we have to do is Log in to our azure account from Azure CLI. There are [multiple ways](https://docs.microsoft.com/en-us/cli/azure/authenticate-azure-cli?view=azure-cli-latest) we can log in and authenticate with the Azure CLI and here we are going to use the *Interactive log-in* option. 

Run the login command and then in the web browser go the given URL and enter the provided code.

```bash
> az login
To sign in, use a web browser to open the page https://aka.ms/devicelogin and 
  enter the code H2ABMSZR3 to authenticate
```
Then log in using the subscription that you wanted to use.

Upon successful log in, you will get a similar JSON as the output in the command prompt.

```json
[
  {
    "cloudName": "AzureCloud",
    "id": "900b4d47-d0c4-888a-9e6d-000061c82010",
    "isDefault": true,
    "name": "...",
    "state": "Enabled",
    "tenantId": "9f67d6b5-5cb4-8fc0-a5cc-345f9cd46e7a",
    "user": {
      "name": "...",
      "type": "user"
    }
  }
]
```
The next step is creating a [new deployment user](https://docs.microsoft.com/en-us/azure/app-service/app-service-deployment-credentials).

A deployment user is required for doing local git deployment to a web app.

```bash
> az webapp deployment user set --user-name fstdeployer --password secret123
```
```json
{
  "id": null,
  "kind": null,
  "name": "web",
  "publishingPassword": null,
  "publishingPasswordHash": null,
  "publishingPasswordHashSalt": null,
  "publishingUserName": "fstdeployer",
  "type": "Microsoft.Web/publishingUsers/web",
  "userName": null
}
```

The next thing is creating a [resource group](https://docs.microsoft.com/en-us/azure/azure-resource-manager/resource-group-overview#resource-groups) in Azure. 

A resource group is a logical container into which Azure resources like web apps, databases, and storage accounts are deployed and managed.

```bash
> az group create --name fsTweetResourceGroup --location "Central US"
```

> You can get a list of all the locations available using the `az appservice list-locations` command


```json
{
  "id": "/subscriptions/{id}/resourceGroups/fsTweetResourceGroup",
  "location": "centralus",
  "managedBy": null,
  "name": "fsTweetResourceGroup",
  "properties": {
    "provisioningState": "Succeeded"
  },
  "tags": null
}
```

To host our application in Azure App Service we first need to have a [Azure App Service Plan](https://docs.microsoft.com/en-us/azure/app-service/azure-web-sites-web-hosting-plans-in-depth-overview)

Let's creates an App Service plan named `fsTweetServicePlan` in the Free pricing tier

```bash
> az appservice plan create --name fsTweetServicePlan --resource-group fsTweetResourceGroup --sku FREE
```
```json
{
  "name": "fsTweetServicePlan",
  "provisioningState": "Succeeded",
  "resourceGroup": "fsTweetResourceGroup",
  "sku": {
    ...
    "tier": "Free"
  },
  "status": "Ready",
  ...
}
```

Then using the `az webapp create` command, create a new [web app](https://docs.microsoft.com/en-us/azure/app-service/app-service-web-overview) in the App Service. 

```bash
> az webapp create --name fstweet --resource-group fsTweetResourceGroup \
  --plan fsTweetServicePlan --deployment-local-git
```

```bash
Local git is configured with url of 
  'https://fstdeployer@fstweet.scm.azurewebsites.net/fstweet.git'
{
  // a big json object
}
```

> The `--deployment-local-git` flag, creates a remote git directory for the web app and we will be using it to push our local git repository and deploy the changes. 
  
> Note down the URL of the git repository as we'll be using it shortly.

We’ve created an empty web app, with git deployment enabled. If you visit the http://fstweet.azurewebsites.net/ site now, we can see an empty web app page.

![Empty Web App Page](/img/fsharp/series/fstweet/azure_empty_app.png)

We are just two commands away from deploying our application in Azure.

The FsTweet Application uses a set of environment variables to get the application's configuration parameters (Connection string, GetStream secret, etc.,). To make these environment variables avilable for the application, we can leverage the App Settings.

Open the [Azure Portal](http://portal.azure.com), Click *App Services* on the left and then click *fstweet* from the list.

![Azure App Service](/img/fsharp/series/fstweet/azure_portal_app_services.png)

In the *fstweet* app service dashboard, click on *Applciation Settings* and enter all the required configuration parameters and don't forget to click the *Save* button!

![App Settings](/img/fsharp/series/fstweet/app_services_app_settings.png) 

> We can do this using [Azure CLI appsettings](https://docs.microsoft.com/en-us/cli/azure/webapp/config/appsettings?view=azure-cli-latest#az_webapp_config_appsettings_set) command as well. 

Now all set for deploying the application.

Add the git URL that we get after creating the web app as [git remote](https://git-scm.com/book/en/v2/Git-Basics-Working-with-Remotes)

```bash
> git remote add azure \
    https://fstdeployer@fstweet.scm.azurewebsites.net/fstweet.git
```

> This command assumes that the project directory is under git version control. If you haven't done it yet, use the following commands to setup the git repository
```bash
> git init
> git add -A
> git commit -m "initial commit"
```

The last step is pushing our local git repository to the azure (alias of the remote git repository). It will prompt you to enter the password. Provide the password that we used to create the deployment user.

```bash
> git push azure master
Passsword for 'https://fstdeployer@fstweet.scm.azurewebsites.net': 
```

Then sit back and watch the launch!

```bash
Counting objects: 1102, done.
Delta compression using up to 4 threads.
....
....
....
remote: ------------------------------------------------------
remote: Build Time Report
remote: ------------------------------------------------------
remote: Target                             Duration
remote: ------                             --------
remote: Clean                              00:00:00.0018425
remote: BuildMigrations                    00:00:01.1475457
remote: RunMigrations                      00:00:01.9743288
remote: VerifyLocalDbConnString            00:00:00.0035704
remote: ReplaceLocalDbConnStringForBuild   00:00:00.0065504
remote: Build                              00:00:45.9225862
remote: RevertLocalDbConnStringChange      00:00:00.0060335
remote: Views                              00:00:00.0625286
remote: Assets                             00:00:00.0528166
remote: CopyWebConfig                      00:00:00.0094524
remote: Deploy                             00:00:00.9716061
remote: Total:                             00:00:50.2883751
remote: ------------------------------------------------------
remote: Status:                            Ok
remote: ------------------------------------------------------
remote: Running post deployment command(s)...
remote: Deployment successful.
To https://fstweet.scm.azurewebsites.net/fstweet.git
   f40d33c..a2a7732  master -> master
```

Awesome! We made it!!

Now if you browse the site, we can see the beautiful landing page :)

![](/img/fsharp/series/fstweet/azure_deplyed.png)

After the deployment, if we want make any change, just do a git commit after making the changes and push it to the remote as we did now!

If we don't want to do it manually, we can [enable contionus deployment](https://docs.microsoft.com/en-us/azure/app-service/app-service-continuous-deployment) from the azure portal.

## Summary

In this blog post, we have made changes to codebase to enable the deployment and deployed our application on Azure using Azure CLI. 

We owe a lot of thanks to FAKE, which made our job easier. 

The source code assoiciated with this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.20)  
