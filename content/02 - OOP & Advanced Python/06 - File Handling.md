---
tags:
  - python
  - file-handling
  - serialization
  - json
difficulty: beginner
prerequisites:
  - Classes & Objects
created: 2026-09-29
---

> [!info] Where this fits
> This is the first of the advanced Python topics, after the OOP pillars ([[Classes & Objects]] through [[Abstraction]]). File handling is how a program reads and writes data that outlives it, and for a data scientist almost every dataset arrives as a file. The note ends with serialization (JSON) and pickling, the standard ways to save structured data and whole objects, which you will use constantly to store models and results later.

A **file** is data stored on disk that persists after your program ends. This note covers reading and writing text files, the `with` context manager, processing files too big for memory, moving a file cursor, binary files, and finally **serialization**, saving complex Python objects (and even class instances) to JSON or a pickle so they can be reloaded or shipped elsewhere.

---

## Text files versus binary files, and the I/O flow

All input/output deals with two kinds of data:

- **Text**: a sequence of Unicode characters. Program files, `.txt`, `.csv`, anything human-readable.
- **Binary**: raw bytes (`1`s and `0`s). Images, audio, video, executables.

So there are two kinds of file to handle: **text files** and **binary files**. Either way, working with a file is always three steps:

1. **Open** the file (through the language).
2. **Read** from it or **write** to it.
3. **Close** it.

> [!note]
> Reading and writing are the only two operations. Watching a video *reads* the file; editing it *writes* to the file. Everything in this note is a variation on open → read/write → close.

---

## Writing to a text file

`open(path, mode)` returns a **file object** (a handle) you use to read or write. The **mode** says what you intend to do. To write, use `'w'`:

```python
f = open('sample.txt', 'w')
f.write('hello world')
f.close()
```

Three things happen: `open` creates the file if it does not exist, `write` puts text in it, and `close` finishes the job. If you give only a name (not a full path), the file is created in the same directory as your program; give a full path to put it elsewhere.

> [!warning]
> After `f.close()`, the handle is dead. Any `f.write(...)` or `f.read()` on a closed file raises `ValueError: I/O operation on closed file`. Open, use, close, in that order.

The write modes differ in what they do to existing content:

| Mode | Meaning | If the file already has content |
| :--- | :--- | :--- |
| `'w'` | write | **erased** and replaced |
| `'a'` | append | **kept**; new text added at the end |

```python
# 'w' replaces everything that was there
with open('sample.txt', 'w') as f:
    f.write('Salman Khan')      # old "hello world" is gone

# 'a' keeps the old content and adds to it
with open('sample.txt', 'a') as f:
    f.write('\nI am fine')      # appended on a new line
```

To write several lines at once, build a list and use `writelines`:

```python
lines = ['hello\n', 'hi\n', 'how are you\n', 'I am fine\n']
with open('sample.txt', 'w') as f:
    f.writelines(lines)         # one call writes every line
```

---

## The `with` context manager

Calling `f.close()` by hand is easy to forget, and a forgotten handle wastes memory and leaves the file open. The **`with` statement** is a context manager that **closes the file automatically** the moment the block ends.

```python
with open('sample.txt', 'w') as f:
    f.write('Salman bhai')
# file is already closed here, no f.close() needed
```

- `with open(...) as f:` opens the file and binds the handle to `f`.
- When the indented block finishes, the file is closed for you, even if an error occurs.

> [!tip]
> Always close a file, for two reasons. **Memory**: an open file sits in RAM until closed (or until the garbage collector eventually gets to it), which matters for large files. **Safety**: an open stream is a door into the file that other code could use. `with` handles both without you remembering, so prefer it over manual `open`/`close`.

Everything below uses `with`.

---

## Reading a text file

Two methods read text, and they differ in how much they pull at once:

| Method | Reads | Use when |
| :--- | :--- | :--- |
| `read()` | the whole file as one string | the file is small |
| `read(n)` | the next `n` characters | you want a fixed chunk |
| `readline()` | the next single line | the file is large; process line by line |

```python
with open('sample.txt', 'r') as f:
    print(f.read())        # entire file
```

> [!note]
> Reading always returns a **string**, and writing only accepts a string. A text file does not understand numbers, lists, or dictionaries; it treats everything as text. Writing a non-string like `f.write(5)` raises an error, you must write `f.write('5')`. Reading them back gives you text, not the original type. (Serialization, below, is how you get real data types back.)

`readline()` reads one line per call, which is how you stream a large file without loading it whole. Since you rarely know the line count in advance, loop until a read returns an empty string (the end of the file):

```python
with open('big.txt', 'r') as f:
    while True:
        line = f.readline()
        if line == '':         # empty string means end of file
            break
        print(line, end='')    # end='' avoids a double line break
```

---

## Reading a big file in chunks

A file can be larger than your RAM, a 10 GB file will not fit in 8 GB of memory. The fix is to read it a **chunk** at a time: pull a fixed number of characters, process them, discard, and repeat. Only one chunk is ever in memory.

```python
with open('big.txt', 'r') as f:
    chunk_size = 100
    while True:
        chunk = f.read(chunk_size)
        if chunk == '':            # empty string means end of file
            break
        print(chunk, end='')
```

Read each chunk into a variable **once**, process it, then read the next. When the file is exhausted `f.read(chunk_size)` returns an empty string, which ends the loop. Reading in the condition and again in the body would skip chunks, so always capture the chunk in a variable first.

> [!tip]
> Think of moving a pile of bricks one at a time instead of lifting the whole stack. You never hold more than one brick, so the pile can be any size. Libraries like pandas and Keras read huge files this way internally; you rarely write chunking by hand, but knowing it demystifies how they stay within memory.

---

## Moving the cursor: `tell` and `seek`

When a file is open, a cursor tracks your position in it (this is the **buffer**, the file loaded into memory where reads and writes happen). Two methods inspect and move it:

- **`f.tell()`** returns the current cursor position (which character comes next).
- **`f.seek(n)`** moves the cursor to position `n`.

```python
with open('sample.txt', 'r') as f:
    print(f.read(10))   # first 10 characters; cursor now at 10
    print(f.tell())     # 10
    f.seek(0)           # jump back to the start
    print(f.read(10))   # the same first 10 characters again
    f.seek(15)          # jump to position 15
    print(f.read(10))   # characters 15 to 24
```

> [!tip]
> `seek` is the scrub bar on a YouTube video: it lets you jump anywhere in the file, start, middle, or end, rather than only reading straight through. `tell` reports where that bar currently sits.

`seek` also affects writing: writing after seeking overwrites from the cursor position rather than replacing the whole file, so it changes only as many characters as you write.

---

## Binary files

Text modes (`'r'`, `'w'`, `'a'`) only understand Unicode characters, so reading an image with `'r'` fails with a decode error, its bytes are not valid text. Binary files use the **binary modes**:

| Mode | Meaning |
| :--- | :--- |
| `'rb'` | read binary |
| `'wb'` | write binary |

Copying an image is reading its bytes and writing them to a new file:

```python
with open('screenshot.png', 'rb') as rf:
    with open('screenshot_copy.png', 'wb') as wf:
        wf.write(rf.read())      # bytes in, bytes out
```

The flow is identical to text files; only the mode (and the data being bytes, not strings) changes.

---

## Serialization and deserialization

Text files store strings, so saving a dictionary or list by writing it as text and reading it back gives you a *string that looks like* a dict, not a usable dict. **Serialization** solves this.

- **Serialization**: converting a Python object into a standard notation that any language can read.
- **Deserialization**: converting that notation back into a Python object.

**JSON** (JavaScript Object Notation) is the universal format for this. It is language-agnostic, every programming language and web API understands it, and it represents dictionaries, lists, strings, numbers, and booleans in human-readable text.

Python's `json` module has two file functions:

- **`json.dump(obj, f)`** serializes `obj` into the open file `f`.
- **`json.load(f)`** deserializes the file `f` back into a Python object.

```python
import json

d = {'name': 'Aarav', 'marks': [23, 14, 34, 45, 56]}

# serialize: Python object -> JSON file
with open('demo.json', 'w') as f:
    json.dump(d, f, indent=4)    # indent=4 pretty-prints it

# deserialize: JSON file -> Python object
with open('demo.json', 'r') as f:
    data = json.load(f)

print(type(data))    # <class 'dict'>, a real dictionary, not a string
```

The payoff: `json.load` returns a genuine `dict`, so nested lists and dictionaries round-trip correctly, no manual type conversion, which the plain text approach could not do.

> [!note]
> Two quirks worth knowing. A **tuple is serialized as a list**, deserializing gives you a list, not a tuple (convert it back with `tuple(...)` if needed). And `json.dumps` / `json.loads` (with an `s`) are the string versions: they serialize to and from a string rather than a file.

### Serializing a custom object

JSON cannot serialize an instance of your own class directly, `json.dump(person, f)` raises "object of type Person is not JSON serializable", because JSON does not know how your object maps to its format. You tell it, by passing a function to `default` that turns the object into something JSON understands (usually a dict):

```python
import json

class Person:
    def __init__(self, fname, lname, age, gender):
        self.fname, self.lname, self.age, self.gender = fname, lname, age, gender

def show_object(person):
    if isinstance(person, Person):
        return {
            'name': person.fname + ' ' + person.lname,
            'age': person.age,
            'gender': person.gender,
        }

p = Person('Aarav', 'Singh', 33, 'male')
with open('demo.json', 'w') as f:
    json.dump(p, f, default=show_object, indent=4)
```

This stores a human-readable snapshot of the object, but the result is a dict, the object's *behavior* (its methods) is lost. When you need to preserve the object itself, use pickling.

---

## Pickling

**Pickling** converts a Python object into a byte stream; **unpickling** converts that byte stream back into the object. Unlike JSON, pickling preserves the whole object, so after unpickling you can call its methods exactly as before.

The `pickle` module mirrors `json`, but works in binary mode:

- **`pickle.dump(obj, f)`** pickles `obj` to the open binary file `f`.
- **`pickle.load(f)`** unpickles it back into the object.

```python
import pickle

class Person:
    def __init__(self, name):
        self.name = name
    def display_info(self):
        print('Hi, my name is', self.name)

p = Person('Aarav')

# pickle: object -> binary file (note the 'wb' mode)
with open('person.pkl', 'wb') as f:
    pickle.dump(p, f)

# unpickle: binary file -> object (note the 'rb' mode)
with open('person.pkl', 'rb') as f:
    loaded = pickle.load(f)

loaded.display_info()    # Hi, my name is Aarav, the method still works
```

The unpickled object is fully functional, it keeps access to its class's methods, which is why pickle is **transferable**: you can pickle an object on one machine and unpickle it on another.

### Pickle versus JSON

| | Pickle | JSON |
| :--- | :--- | :--- |
| Format | binary byte stream | human-readable text |
| Preserves object behavior | yes (methods survive) | no (snapshot only) |
| Readable by other languages | no (Python-only) | yes (universal) |
| Use for | shipping a whole object/model | storing data as readable text |

> [!tip]
> This is why data scientists use pickle constantly: a trained machine learning model is a Python object. You pickle it on the machine where it was built and unpickle it on a server where it runs, carrying the object's full functionality across machines. Reach for JSON when you want portable, human-readable data; reach for pickle when you must preserve the live object.

---

## Summary

1. I/O deals with text (Unicode) and binary (bytes) data; working with any file is open → read/write → close.
2. `open(path, mode)` returns a file handle: `'w'` writes and replaces, `'a'` appends, `'r'` reads; `writelines` writes a list of lines at once.
3. The `with` statement closes the file automatically; always close files, for memory and safety.
4. `read()` loads the whole file, `read(n)` loads `n` characters, and `readline()` loads one line, used in a loop (stop on an empty string) for large files.
5. A file too big for RAM is read in chunks with `read(chunk_size)` in a loop, so only one chunk is in memory at a time.
6. `tell()` reports the cursor position and `seek(n)` moves it, like a scrub bar over the file.
7. Binary files use `'rb'` and `'wb'`; the flow is the same, the data is bytes.
8. Serialization converts a Python object to a universal format; JSON (`json.dump`/`json.load`) round-trips dicts and lists as real objects, with `default` handling custom classes (as a snapshot).
9. Pickling (`pickle.dump`/`pickle.load`, in binary mode) stores an object as a byte stream and preserves its behavior, so it can be reloaded or shipped to another machine, which is how trained models are saved.

---

> [!info] Continues to
> Files and external data are a common source of runtime failures (a missing file, a bad format). The next topic, [[Exception Handling]], shows how to catch and respond to those errors instead of letting the program crash.
