module nested {
  var routingState: { count: int }

  action init = {
    routingState' = { count: 0 }
  }

  action Increment = {
    nondet amount = Set(1, 2, 3).oneOf()
    routingState' = { count: routingState.count + amount }
  }

  action step = any {
    Increment,
  }
}
