---
tags:
  - python
  - oop
  - polymorphism
  - operator-overloading
difficulty: intermediate
prerequisites:
  - Inheritance
created: 2026-09-29
---

> [!info] Where this fits
> This is the fourth core pillar of object-oriented programming, following [[Classes & Objects]], [[Encapsulation]], and [[Inheritance]]. Inheritance introduced method overriding, one face of a broader idea. This note gathers that idea, polymorphism, in one place and shows its three forms in Python.

**Polymorphism** means "many forms": the same thing behaves differently depending on context. In OOP it appears in three ways, all built on ideas you have already met.

| Form | Same thing that varies | Varies based on |
| :--- | :--- | :--- |
| **Method overriding** | a method name across parent and child | the object's class |
| **Method overloading** | a method name within one class | the arguments passed |
| **Operator overloading** | an operator like `+` | the operand types |

---

## Method overriding

**Method overriding** is polymorphism across inheritance: parent and child define a method with the same name, and calling it on a child object runs the **child's** version.

```python
class Phone:
    def buy(self):
        print('buying a phone')

class SmartPhone(Phone):
    def buy(self):
        print('buying a smartphone')

SmartPhone().buy()   # buying a smartphone
Phone().buy()        # buying a phone
```

The same call, `.buy()`, takes a different form depending on the object's class. This was introduced in [[Inheritance]]; here it is one of the three faces of polymorphism.

---

## Method overloading

**Method overloading** is one method name in a single class behaving differently based on its inputs. It keeps code readable: one `area` method for both a circle (one argument) and a rectangle (two), instead of two differently named methods.

```python
class Shape:
    def area(self, a, b=0):
        if b == 0:
            return 3.14 * a * a     # circle
        else:
            return a * b            # rectangle

s = Shape()
print(s.area(5))       # 78.5  (circle)
print(s.area(4, 6))    # 24    (rectangle)
```

The benefit is a cleaner interface: the caller thinks in one verb, `area`, and the method adapts.

> [!warning]
> Python does not support classic method overloading, where two methods share a name. If you define `area` twice, the second definition simply replaces the first. You get the same effect with **default arguments**, as above, so one method adapts to how many arguments arrive.

---

## Operator overloading

**Operator overloading** is the same operator behaving differently for different operand types. Python's `+` already does this out of the box.

| Expression | Operand types | Behavior | Result |
| :--- | :--- | :--- | :--- |
| `'hello' + 'world'` | string, string | concatenation | `'helloworld'` |
| `4 + 5` | int, int | addition | `9` |
| `[1, 2] + [3, 4]` | list, list | merging | `[1, 2, 3, 4]` |

One operator, three forms, chosen by the operands. You define what an operator means for **your own type** with the arithmetic magic methods:

- `__add__` for `+`
- `__sub__` for `-`
- `__mul__` for `*`
- `__truediv__` for `/`

This is exactly how the `Fraction` type in [[Classes & Objects]] taught `+` to add two fractions.

```python
class Fraction:
    def __init__(self, n, d):
        self.num = n
        self.den = d

    def __add__(self, other):
        new_num = self.num * other.den + other.num * self.den
        new_den = self.den * other.den
        return Fraction(new_num, new_den)
```

Defining `__add__` on `Fraction` was operator overloading all along: it gave the `+` operator a new form for a new type.

---

## Summary

1. Polymorphism means one thing taking many forms, appearing in OOP as method overriding, method overloading, and operator overloading.
2. Method overriding varies a shared method name across parent and child; the child's version runs on a child object.
3. Method overloading varies a method name within one class by its arguments; Python has no true overloading, so default arguments achieve the same effect.
4. Operator overloading varies an operator by operand type; `+` already concatenates strings, adds numbers, and merges lists.
5. You give an operator a new form for your own type with arithmetic magic methods (`__add__`, `__sub__`, `__mul__`, `__truediv__`), as done for the `Fraction` type.

---

> [!info] Continues to
> The final pillar of object-oriented programming is [[Abstraction]], which shows how a parent class can hide implementation detail while forcing its child classes to provide certain methods.
