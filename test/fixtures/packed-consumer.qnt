module packed_consumer {
  var count: int

  action init = {
    count' = 0
  }

  action AddHuge = {
    nondet amount = Set(900719925474099312345678901234567890).oneOf()
    count' = count + amount
  }

  action step = any {
    AddHuge,
  }
}
