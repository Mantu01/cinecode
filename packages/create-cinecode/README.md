# create-cinecode

Scaffold a Cinecode project.

```bash
pnpm create cinecode my-film
# or
npx create-cinecode@latest my-film
```

## Usage

```
create-cinecode <directory> [options]

--ts                 Use TypeScript
--js                 Use JavaScript
--fps <number>       Frames per second (default 30)
--resolution <size>  Preset or WxH (default 1920x1080)
--no-git             Skip git initialization
--skip-install       Skip dependency installation
-f, --force          Proceed if the directory is not empty
--dry-run            Print the plan without writing files
-v, --verbose        Verbose output
```

The generated project pins the framework on a registry range and ships a config,
a composition entry, a scene, a timeline and a `tsconfig.json`. Requires Node.js
22.18.0 or newer.

## Documentation

- [Documentation Hub](../../docs/README.md)
- [Architecture Rules & Contracts](../../docs/rules.md)

## License

MIT
