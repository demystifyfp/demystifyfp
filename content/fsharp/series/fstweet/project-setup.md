---
title: "Setting Up FsTweet Project"
date: 2017-08-15T20:02:30+05:30
tags: [forge,FAKE,paket,fsharp]
---

Hi,

In this first part of the series on [Creating a Twitter Clone in F# using Suave]({{< relref "intro.md">}}), we will be starting the project from scratch and configuring it to use [FAKE](https://fake.build/) and [Paket](https://fsprojects.github.io/Paket/)


Let's get started by creating an empty directory with the name *FsTweet*

```bash
> mkdir FsTweet
```

We are going to use [Forge](http://forge.run/), a command line tool that provides tasks for creating and managing F# projects. 

This series uses Forge [**version 1.4.2**](https://github.com/fsharp-editing/Forge/releases/tag/1.4.2). 

> Post this version, Forge has been updated to work with dotnet core, and it's not backward compatible. 

You can install Forge, by following the [installation instructions](https://github.com/fsharp-editing/Forge/wiki/Getting-started)

After installation, initialize paket using the `forge paket init` command

```bash
> cd FsTweet
> forge paket init
```

This will download the *paket.exe* in the *.paket* directory along with *paket.dependencies* file in the project root directory.

 To [restrict paket](https://fsprojects.github.io/Paket/dependencies-file.html#Framework-restrictions) to use the .NET Framework 4.6.1 version, we need to add, `framework: net461` in a new line in the *paket.dependencies* file.

If you prefer to do this from your command line interface, you can achieve it using the following command

```
> echo 'framework: net461' >> paket.dependencies
```

The next step is creating a [new project](https://github.com/fsharp-editing/Forge/wiki/new-project) and adding the [FAKE](https://fake.build/legacy-gettingstarted.html) using Forge. 

```bash
> forge new project -n FsTweet.Web --dir src -t suave
```

This command creates a new console project in *./src/FsTweet.Web* directory pre-configured with a Suave template. 

> You may encounter the following error while running this command
  ```bash
  Unhandled error:
  Could not find file ".../FsTweet/src/build.sh".
  ```
  This was a [known issue](https://github.com/fsharp-editing/Forge/issues/54#issuecomment-284559266) in Forge which has been fixed in the later version. You can ignore it in our case. 


That's all!

We can verify the setup by building the project using Forge

```bash
> forge build
```

This command internally calls the `fake` command to build the project. 

Upon successful completion of this command, we can find the *FsTweet.Web.exe* file in the *FsTweet/build* directory.

When you run it, 

```bash
> build/FsTweet.Web.exe
```

> if you are on non-windows platform
  ```bash
  > mono build/FsTweet.Web.exe
  ```

It will start the Suave standalone web server on port `8080`.

```bash
...
[21:42:45 INF] Smooth! Suave listener started in 138.226 with binding 127.0.0.1:8080
```

You will be seeing `Hello World!`, when you curl the application's root endpoint

```bash
> curl http://127.0.0.1:8080/
Hello World!
```

As we will be building and running the application often during our development, let's leverage Fake and Forge to simplify this mundane task.

In the FAKE build script, *build.fsx*, remove the `Deploy` Target

```fsharp
// build.fsx
Target "Deploy" (fun _ ->
    !! (buildDir + "/**/*.*")
    -- "*.zip"
    |> Zip buildDir (deployDir + "ApplicationName." + version + ".zip")
)
```

and add the `Run` Target

```fsharp
// build.fsx
Target "Run" (fun _ -> 
    ExecProcess 
        (fun info -> info.FileName <- "./build/FsTweet.Web.exe")
        (System.TimeSpan.FromDays 1.)
    |> ignore
)
```

As the name indicates, the `Run` Target runs our application from the build directory using the [ExecProcess](https://fake.build/apidocs/fake-core-process.html) function in FAKE.

Then change the build order to use `Run` instead of `Deploy`

```fsharp
// Build order
"Clean"
  ==> "Build"
  ==> "Run"
```

The final step is creating *Forge.toml* file in the root directory, *FsTweet* and add an `run` [alias](https://github.com/fsharp-editing/Forge/wiki/Aliases) to run Fake's `Run` target

```toml
# Forge.toml
[alias]
  run='fake Run'
```

With this alias in place, we can build and run our application using a single command

```bash
> forge run
```

> From here on, the term *run/test drive the application* in the following blog posts implies running this `forge run` command. 

# Summary

In this part, we have learned how to bootstrap a project from scratch and configure it to use Paket and FAKE. 

Using Forge, we orchestrated the project setup, and the cherry on the cake is the alias to build and run our project with a single command! 

The source code is available on [GitHub](https://github.com/demystifyfp/FsTweet/tree/v0.0)