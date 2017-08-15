---
title: "Part 0: Project Setup"
date: 2017-08-15T20:02:30+05:30
draft: true
---

```bash
> mkdir FsTweet
```

```bash
> forge paket init
```

`framework: net461`

```
> echo 'framework: net461' >> paket.dependencies
```

```bash
> forge new project -n FsTweet.Web --dir FsTweet.Web -t suave
```

```bash
Unhandled error:
Could not find file ".../FsTweet/FsTweet.Web/build.sh".
```

```bash
> forge build
```

```bash
> build/FsTweet.Web.exe
```

```bash
> mono build/FsTweet.Web.exe
```

```bash
[21:42:45 INF] Smooth! Suave listener started in 138.226 with binding 127.0.0.1:8080
```

```bash
> curl http://127.0.0.1:8080/
Hello World!
```

```fsharp
Target "Deploy" (fun _ ->
    !! (buildDir + "/**/*.*")
    -- "*.zip"
    |> Zip buildDir (deployDir + "ApplicationName." + version + ".zip")
)
```

```fsharp
Target "Run" (fun _ -> 
    ExecProcess 
        (fun info -> info.FileName <- "./build/FsTweet.Web.exe")
        (System.TimeSpan.FromDays 1.)
    |> ignore
)
```

```fsharp
// Build order
"Clean"
  ==> "Build"
  ==> "Run"
```

```toml
[alias]
  run='fake Run'
```

```bash
> forge run
```