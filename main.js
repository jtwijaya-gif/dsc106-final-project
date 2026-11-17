const svg = d3.select("#visualization")
  .append("svg")
  .attr("width", 700)
  .attr("height", 300);

svg.append("text")
  .attr("x", 350)
  .attr("y", 150)
  .attr("text-anchor", "middle")
  .attr("font-size", 20)
  .text("Our climate visualization will go here!");