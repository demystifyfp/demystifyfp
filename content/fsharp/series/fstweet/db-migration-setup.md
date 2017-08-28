---
title: "Setting Up Database Migration"
date: 2017-08-26T18:47:29+05:30
tags: [FAKE, FluentMigrator, OOInFsharp, fsharp]
---

Hi,

In the [last blog post]({{< relref "user-signup-validation.md">}}), we validated the signup details submitted by the user and transformed it into a domain model.

The next step is persisting it in a database. We are going to use [PostgreSQL](https://www.postgresql.org) to achieve it. 

In this sixth part of the [Creating a Twitter Clone in F# using Suave](TODO) blog post series, we are going to learn how to setup PostgreSQL database migrations in fsharp using [Fluent Migrator](https://github.com/fluentmigrator/fluentmigrator). 

In the [following blog post]({{< relref "orchestrating-user-signup.md" >}}), we will be orchastrating the user signup. 

## Creating a Database Migrations Project

[Fluent Migrator](https://github.com/fluentmigrator/fluentmigrator)s is one of the widely used Migration frameworks in .NET outside [EF code first migrations](https://msdn.microsoft.com/en-us/library/jj591621(v=vs.113).aspx). 

As we are not going to use EF in favor of [SQLProvider](fsprojects.github.io/SQLProvider/), we are picking the fluent migrator to help us in managing the database schema.

Let's get started by creating a new class library project, *FsTweet.Db.Migrations*, in the *src* directory, using forge. 

```bash
> forge new project -n FsTweet.Db.Migrations \
    --folder src -t classlib --no-fake
```

The next step is adding the *FluentMigrator* NuGet package and referring it in the newly created *FsTweet.Db.Migrations* project. 

```bash
> forge paket add FluentMigrator -g Database \
    -p src/FsTweet.Db.Migrations/FsTweet.Db.Migrations.fsproj
```

We are using the paket's [dependency grouping](https://fsprojects.github.io/Paket/groups.html) feature using the `-g` argument with the value `Database`. It allows us to organize the dependencies better

*paket.dependencies*
```
...

group Database
source https://www.nuget.org/api/v2

nuget FluentMigrator
```

To create [a migration](https://github.com/fluentmigrator/fluentmigrator/wiki/Migration) in Fluent Migrator, we need to create a new class inheriting Fluent Migrator's `Migration` abstract class. 

This class also has to have an attribute `Migration` to specify the order of the migration and also it should override the `Up` and `Down` methods.

Fsharp provides nicer support [to write OO code](https://fsharpforfunandprofit.com/series/object-oriented-programming-in-fsharp.html). So writing the migration is straight forward and we don't need to go back to *C#!* 

As a first step, clean up the default code in the `FsTweet.Db.Migrations.fs` file and update it as below. 

```fsharp
namespace FsTweet.Db.Migrations

open FluentMigrator

[<Migration(201709250622L, "Creating User Table")>]
type CreateUserTable()=
  inherit Migration()

  override this.Up() = ()
  override this.Down() = ()
```

As [suggested](https://lostechies.com/seanchambers/2011/04/02/fluentmigrator-getting-started/) by [Sean Chambers](https://lostechies.com/seanchambers/author/seanchambers/), one of core contributor of fluent migrator, we are using a time stamp in `YYYYMMDDHHMM` format in UTC to specify the migration order. 

The next step is using the fluent methods offered by the fluent migrator we need to define the `Users` table and its columns.

```fsharp
// ...
type CreateUserTable()=
  // ...
  override this.Up() = 
    base.Create.Table("Users")
      .WithColumn("Id").AsInt32().PrimaryKey().Identity()
      .WithColumn("Username").AsString(12).NotNullable()
      .WithColumn("Email").AsString(254).NotNullable()
      .WithColumn("PasswordHash").AsString().NotNullable()
      .WithColumn("EmailVerificationCode").AsString().NotNullable()
      .WithColumn("IsEmailVerified").AsBoolean()
    |> ignore
  // ...
``` 

The last step is overriding the `Down` method. In the `Down` method, we just need to delete the `Users` table. 

```fsharp
type CreateUserTable()=
  // ...
  override this.Down() = 
    base.Delete.Table("Users") |> ignore
  // ...
``` 

## Building the Migrations Project

Now we have the migrations project in place, and it is all set to build and run.

Let's add a new FAKE Target `BuildMigrations` in the build script to build the migrations. 

```fsharp
// build.fsx
// ...
Target "BuildMigrations" (fun _ ->
  !! "src/FsTweet.Db.Migrations/*.fsproj"
  |> MSBuildDebug buildDir "Build" 
  |> Log "MigrationBuild-Output: "
)
// ...
```

Then we need to change the existing `Build` target to build only the `FsTweet.Web` project instead of all the `.fsproj` projects in the application.

```fsharp
// build.fsx
// ...
Target "Build" (fun _ ->
  !! "src/FsTweet.Web/*.fsproj"
  |> MSBuildDebug buildDir "Build"
  |> Log "AppBuild-Output: "
)
// ...
```

To run the migration against Postgres, we need to install the [Npgsql](http://www.npgsql.org/) package from NuGet.

```bash
> forge paket add Npgsql -g Database --version 3.1.10
```

> At the time of this writing there is [an issue](https://github.com/npgsql/npgsql/issues/1603) with the latest version of Npgsql. So, we are using the version `3.1.10` here. 

FAKE has inbuilt support for [running fluent migration](https://fake.build/todo-fluentmigrator.html) from the build script.

To do it add the references of the `FluentMigrator` and `Npgsql` DLLs in the build script.

```fsharp
// build.fsx
// ...
#r "./packages/FAKE/tools/Fake.FluentMigrator.dll"
#r "./packages/database/Npgsql/lib/net45/Npgsql.dll"
// ...
open Fake.FluentMigratorHelper
// ...
```

Then define `RunMigrations` Target with a `connString` and a `dbConnection` pointing to a local database.

```fsharp
// build.fsx
// ...
let connString = 
  @"Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=test;"
let dbConnection = ConnectionString (connString, DatabaseProvider.PostgreSQL)

Target "RunMigrations" (fun _ -> 
  MigrateToLatest dbConnection [migrationsAssembly] DefaultMigrationOptions
)
// ...
```

This migration script **doesn't create the database**.

So, we need to create it manually before we run the script.

The last step in running the migration script is adding it to the build script build order. 

We need to run the migrations before the `Build` target, as we need to have the database schema in place to use [SQLProvider](fsprojects.github.io/SQLProvider/) to interact with the PostgreSQL.

```fsharp
// build.fsx
// ...
"Clean"
==> "BuildMigrations"
==> "RunMigrations"
==> "Build"
// ...
```

Then run the build.

```fsharp
> forge build
```

> This command is an inbuilt alias in forge representing the `forge fake Build` command.


While the build script is running, we can see the console log of the `RunMigrations` target like the one below

```bash
...
Starting Target: RunMigrations (==> BuildMigrations)
...
----------------------------------------------------
201709250622: CreateUserTable migrating
----------------------------------------------------
[+] Beginning Transaction
[+] CreateTable Users
[+] Committing Transaction
[+] 201709250622: CreateUserTable migrated
[+] Task completed.
Finished Target: RunMigrations
...
```

Upon successful execution of the build script, we can verify the schema using [psql](https://www.postgresql.org/docs/9.6/static/app-psql.html)

```bash
> psql -d FsTweet
psql (9.6.2, server 9.5.1)
Type "help" for help.

FsTweet=# \d "Users"
                            Table "public.Users"

        Column         |          Type          |                      Modifiers
-----------------------+------------------------+------------------------------------------------------
 Id                    | integer                | not null default nextval('"Users_Id_seq"'::regclass)
 Username              | character varying(12)  | not null
 Email                 | character varying(254) | not null
 PasswordHash          | text                   | not null
 EmailVerificationCode | text                   | not null
 IsEmailVerified       | boolean                | not null
Indexes:
    "PK_Users" PRIMARY KEY, btree ("Id")
```

Cool! The migrations went well :)

## Extending the Connection String

In the script that we ran, the connection string is hard coded. To make it reusable across different build environments, we need to get it from the environment variable.

FAKE has function `environVarOrDefault`, which takes the value from the given environment name and if the environment variable is not available, it returns the provided default value.

Let's use this function in our build script to make it reusable

```fsharp
// build.fsx
// ...
let connString = 
  environVarOrDefault 
    "FSTWEET_DB_CONN_STRING"
    @"Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=test;"
// ...
```

That's it!

## Summary

In this blog post, we learned how to set up database migration using Fluent Migrator in fsharp and leverage FAKE to run the migrations while running the build script.

The source code for this blog post is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.5)