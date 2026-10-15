import sys

with open("src/cypher_builder.py", "r") as f:
    c = f.read()

# I will replace the bad lines directly
c = c.replace("{`+promo.key_prop+`: promo.key_val}, {`+promo.name_prop+`: promo.name_val}", "apoc.map.fromValues([promo.key_prop, promo.key_val]), apoc.map.fromValues([promo.name_prop, promo.name_val])")
c = c.replace("{`+dyn.target_key+`: dyn.target_val}, {}", "apoc.map.fromValues([dyn.target_key, dyn.target_val]), {}")

with open("src/cypher_builder.py", "w") as f:
    f.write(c)
