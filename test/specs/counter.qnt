module counter {
  var count: int

  action init = {
    count' = 0
  }

  action Increment = {
    nondet amount = Set(1, 2, 3).oneOf()
    count' = count + amount
  }

  action step = any {
    Increment,
  }
}
