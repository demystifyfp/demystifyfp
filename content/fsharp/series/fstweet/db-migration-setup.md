---
title: "Setting Up Database Migration"
date: 2017-08-25T09:38:55+05:30
draft: true
tags: [FAKE, FluentMigrator, OOInFsharp, fsharp]
---


```bash
> forge new project -n FsTweet.Db.Migrations \
    --folder src -t classlib --no-fake
```

```bash
> forge paket add FluentMigrator -g Database \
    -p src/FsTweet.Db.Migrations/FsTweet.Db.Migrations.fsproj
```

*paket.dependencies*
```
group Database
source https://www.nuget.org/api/v2

nuget FluentMigrator
```

```fsharp
namespace FsTweet.Db.Migrations

open FluentMigrator

[<Migration(201709250622L, "Creating User Table")>]
type CreateUserTable()=
  inherit Migration()

  override this.Up() = ()
  override this.Down() = ()
```

![suggessted](https://lostechies.com/seanchambers/2011/04/02/fluentmigrator-getting-started/)

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
```fsharp
type CreateUserTable()=
  // ...
  override this.Down() = 
    base.Delete.Table("Users") |> ignore
  // ...
``` 

```fsharp
Target "BuildMigrations" (fun _ ->
  !! "src/FsTweet.Db.Migrations/*.fsproj"
  |> MSBuildDebug buildDir "Build" 
  |> Log "MigrationBuild-Output: "
)

Target "Build" (fun _ ->
  !! "src/FsTweet.Web/*.fsproj"
  |> MSBuildDebug buildDir "Build"
  |> Log "AppBuild-Output: "
)
```

```bash
> forge paket add Npgsql -g Database
```

```fsharp
// ...

#r "./packages/FAKE/tools/Fake.FluentMigrator.dll"
#r "./packages/database/Npgsql/lib/net45/Npgsql.dll"
// ...
open Fake.FluentMigratorHelper
// ...
let connString = 
  @"Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=test;"
let dbConnection = ConnectionString (connString, DatabaseProvider.PostgreSQL)

Target "RunMigrations" (fun _ -> 
  MigrateToLatest dbConnection [migrationsAssembly] DefaultMigrationOptions
)
```

```fsharp
// Build order
"Clean"
==> "BuildMigrations"
==> "RunMigrations"
==> "Build"
// ...
```

```fsharp
> forge build
```

```bash
...
Starting Target: RunMigrations (==> BuildMigrations)
[+] Using Database postgres and Connection String Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=********;
...
-------------------------------------------------------------------------------
201709250622: CreateUserTable migrating
-------------------------------------------------------------------------------
[+] Beginning Transaction
[+] CreateTable Users
[+] Committing Transaction
[+] 201709250622: CreateUserTable migrated
[+] Task completed.
Finished Target: RunMigrations
...
```

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

```fsharp
let connString = 
  environVarOrDefault 
    "FSTWEET_DB_CONN_STRING"
    @"Server=127.0.0.1;Port=5432;Database=FsTweet;User Id=postgres;Password=test;"
```